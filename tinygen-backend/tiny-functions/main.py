from modal import App, Image, asgi_app, Sandbox, Secret
import subprocess
import os
from typing import Dict
from urllib.parse import urlparse

# Base image for sandboxes
sandbox_base_image = (
    Image.debian_slim()
    .apt_install(
        "curl",
        "git",
        "build-essential",
        "nodejs",
        "npm",
        "unzip",  # its not really required?
        "gh",
    )
    .run_commands(
        "npm install -g @anthropic-ai/claude-code"
    )
    .pip_install(
        "supabase",
        "modal",
        "pyjwt[crypto]", #github app jwt generation
        "requests",
        "claude-code-sdk"
    )
)

# Image with local files added
sandbox_image = (
    sandbox_base_image
    .add_local_file("tiny-functions/github_auth.py", "/root/github_auth.py")
)

app = App("tinygen-functions")

def parse_github_url(repo_url: str) -> tuple[str, str]:
    """Parse GitHub URL to get owner and repo name"""
    # Handle different URL formats
    if repo_url.startswith("git@"):
        # SSH format: git@github.com:owner/repo.git
        parts = repo_url.split(":")[-1].replace(".git", "").split("/")
    elif "github.com" in repo_url:
        # HTTPS format: https://github.com/owner/repo or https://github.com/owner/repo.git
        parsed = urlparse(repo_url)
        parts = parsed.path.strip("/").replace(".git", "").split("/")
    else:
        # Assume format: owner/repo
        parts = repo_url.split("/")
    
    if len(parts) >= 2:
        return parts[0], parts[1]
    else:
        raise ValueError(f"Invalid GitHub URL format: {repo_url}")

@app.function(
    image=sandbox_image,
    secrets=[Secret.from_name("all-tinygen")],
    timeout=600  # 10 minutes timeout for cloning large repos
)
def fork_and_clone_repo(repo_url: str, user_github_username: str, chat_id: str) -> Dict:
    """
    Fork a GitHub repo (if not already forked) and clone it into a sandbox.
    Returns the sandbox snapshot ID.
    """
    # Import the github_auth module inside the function (it's in /root/)

    #i dont think we need this?:
    # import sys i 
    # sys.path.append('/root')
    from github_auth import (
        generate_jwt_token,
        get_installation_id,
        get_installation_access_token,
        authenticate_gh_cli,
        setup_git_config,
        check_repo_access
    )
    
    # Get GitHub App credentials from secrets
    client_id = os.environ["GITHUB_CLIENT_ID"]
    private_key = os.environ["GITHUB_PRIVATE_KEY"]
    
    # Parse repo URL
    owner, repo_name = parse_github_url(repo_url)
    
    # Generate JWT token
    jwt_token = generate_jwt_token(client_id, private_key)
    
    # Get installation ID for the USER, not the repo
    # This lets us work with any repo the user has access to
    installation_id, error = get_installation_id(user_github_username, repo_name, jwt_token)
    if error:
        # Try getting installation for the repo owner as fallback
        installation_id, error = get_installation_id(owner, repo_name, jwt_token)
        if error:
            return {
                "status": "error",
                "error": error
            }
    
    # Get access token for this installation
    access_token = get_installation_access_token(installation_id, jwt_token)
    
    # Create sandbox
    sandbox = Sandbox.create(
        image=sandbox_base_image,  # Use base image, we're creating from scratch
        timeout=600
    )
    
    try:
        # Authenticate gh CLI in sandbox
        authenticate_gh_cli(sandbox, access_token)
        
        # Set up git config
        setup_git_config(sandbox)
        
        # Check if user has direct access to the repo
        has_access = check_repo_access(sandbox, owner, repo_name, user_github_username)
        
        if has_access:
            # User has write access, clone directly without forking
            print(f"User has write access to {owner}/{repo_name}, cloning directly...")
            clone_url = f"https://github.com/{owner}/{repo_name}.git"
            final_repo = f"{owner}/{repo_name}"
        else:
            # User doesn't have write access, need to fork
            print(f"User doesn't have write access, checking for existing fork...")
            
            # Check if fork already exists
            check_fork = sandbox.exec(
                "gh", "repo", "view", f"{user_github_username}/{repo_name}",
                "--json", "name"
            )
            check_fork.wait()
            
            fork_exists = check_fork.returncode == 0
            
            if not fork_exists:
                print(f"Fork doesn't exist, creating fork of {owner}/{repo_name}...")
                fork_process = sandbox.exec(
                    "gh", "repo", "fork", f"{owner}/{repo_name}", 
                    "--clone=false"
                )
                fork_process.wait()
                
                if fork_process.returncode != 0:
                    raise Exception(f"Failed to fork repo: {fork_process.stderr.read()}")
                
                print("Fork created successfully")
            else:
                print("Fork already exists")
            
            clone_url = f"https://github.com/{user_github_username}/{repo_name}.git"
            final_repo = f"{user_github_username}/{repo_name}"
        
        # Clone the repo
        print(f"Cloning {final_repo}...")
        clone_process = sandbox.exec(
            "git", "clone", clone_url
        )
        clone_process.wait()
        
        if clone_process.returncode != 0:
            raise Exception(f"Failed to clone repo: {clone_process.stderr.read()}")
        
        print("Repository cloned successfully")
        
        # Create a snapshot of the sandbox
        print("Creating sandbox snapshot...")
        snapshot = sandbox.snapshot_filesystem()
        snapshot_id = snapshot.object_id
        print(f"Snapshot created with ID: {snapshot_id}")
        
        # Update the database with the snapshot ID
        from supabase import create_client
        supabase_url = os.environ["SUPABASE_URL"]
        supabase_key = os.environ["SUPABASE_ANON_KEY"]
        supabase = create_client(supabase_url, supabase_key)
        
        # Update the chat with the snapshot ID and the actual repo we're working with
        # If we forked, store the fork URL. If not, store the original
        working_repo_url = f"https://github.com/{final_repo}"
        
        update_data = {
            'snapshot_id': snapshot_id,
            'github_repo_url': working_repo_url  # Always store the actual repo we're working with (fork or original)
        }
        
        supabase.table('chats').update(update_data).eq('id', chat_id).execute()
        
        print(f"Updated chat {chat_id} with snapshot {snapshot_id} and repo {working_repo_url}")
        
        return {
            "status": "success",
            "snapshot_id": snapshot_id,
            "clone_url": f"https://github.com/{final_repo}",
            "original_repo": f"{owner}/{repo_name}",
            "forked": not has_access
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            "status": "error",
            "error": str(e)
        }
    finally:
        sandbox.terminate()

@app.function(image=sandbox_image)
def echo_hello():
    result = subprocess.run(
        ["echo", "Hello World"], 
        capture_output=True, 
        text=True, 
        check=True
    )
    print(f"Echo output: {result.stdout.strip()}")
    return {"message": result.stdout.strip(), "status": "success"}



