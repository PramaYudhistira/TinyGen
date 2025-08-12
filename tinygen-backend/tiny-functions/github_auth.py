"""GitHub App authentication module for Modal functions"""
import os
import jwt
import time
import requests
import textwrap
from typing import Tuple, Optional
from modal import Sandbox

def format_private_key(private_key: str) -> str:
    """Format private key with PEM headers if needed"""
    if not private_key.startswith("-----BEGIN RSA PRIVATE KEY-----"):
        key_lines = textwrap.wrap(private_key, 64)
        formatted_key = "\n".join(key_lines)
        return f"-----BEGIN RSA PRIVATE KEY-----\n{formatted_key}\n-----END RSA PRIVATE KEY-----"
    return private_key

def generate_jwt_token(client_id: str, private_key: str) -> str:
    """Generate GitHub App JWT token"""
    formatted_key = format_private_key(private_key)
    
    now = int(time.time())
    payload = {
        "iat": now - 60,  # 60 seconds in the past for clock drift
        "exp": now + 540,  # 9 minutes in the future (less than 10 min max)
        "iss": client_id
    }
    
    return jwt.encode(payload, formatted_key, algorithm="RS256")

def get_installation_id(owner: str, repo: str, jwt_token: str) -> Tuple[Optional[str], Optional[str]]:
    """Get installation ID for a repository
    
    Returns:
        Tuple of (installation_id, error_message)
    """
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    # Try to get installation for specific repo
    install_url = f"https://api.github.com/repos/{owner}/{repo}/installation"
    print(f"Getting installation from: {install_url}")
    install_response = requests.get(install_url, headers=headers)
    
    if install_response.status_code == 200:
        installation_id = install_response.json()["id"]
        print(f"Found installation ID: {installation_id}")
        return str(installation_id), None
    
    # If that fails, list all installations and find the right one
    print("Repo-specific installation not found, listing all installations...")
    list_response = requests.get(
        "https://api.github.com/app/installations",
        headers=headers
    )
    
    if list_response.status_code == 200:
        installations = list_response.json()
        print(f"Found {len(installations)} installations")
        
        # Try to find installation for the owner
        for inst in installations:
            if inst['account']['login'].lower() == owner.lower():
                installation_id = str(inst['id'])
                print(f"Found installation for {owner}: {installation_id}")
                return installation_id, None
        
        # If no specific match, use the first one (for personal repos)
        if installations:
            installation_id = str(installations[0]['id'])
            print(f"Using first available installation: {installation_id}")
            return installation_id, None
    
    return None, f"GitHub App not installed or accessible for {owner}/{repo}"

def get_installation_access_token(installation_id: str, jwt_token: str) -> str:
    """Get installation access token"""
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    token_response = requests.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers=headers
    )
    
    if token_response.status_code != 201:
        raise Exception(f"Failed to get access token: {token_response.text}")
    
    access_token = token_response.json()["token"]
    print("Generated installation access token")
    return access_token

def authenticate_gh_cli(sandbox: Sandbox, access_token: str):
    """Authenticate gh CLI with the token"""
    print("Authenticating gh CLI...")
    auth_process = sandbox.exec(
        "sh", "-c", f"echo '{access_token}' | gh auth login --with-token"
    )
    auth_process.wait()
    
    if auth_process.returncode != 0:
        print(f"gh auth login failed: {auth_process.stderr.read()}")
    else:
        print("gh CLI authenticated successfully")
    
    # Configure git to use gh auth for push/pull operations
    setup_git_process = sandbox.exec("gh", "auth", "setup-git")
    setup_git_process.wait()
    if setup_git_process.returncode == 0:
        print("gh auth setup-git completed - git will now use GitHub App credentials")
    else:
        print(f"gh auth setup-git failed: {setup_git_process.stderr.read()}")

def setup_git_config(sandbox: Sandbox, bot_username: str = "tinygen[bot]"):
    """Configure git to commit as bot user"""
    print(f"Configuring git to commit as {bot_username}...")
    
    bot_email = f"{bot_username}@users.noreply.github.com"
    
    git_config_email = sandbox.exec(
        "git", "config", "--global", "user.email", bot_email
    )
    git_config_email.wait()
    
    git_config_name = sandbox.exec(
        "git", "config", "--global", "user.name", bot_username
    )
    git_config_name.wait()
    print(f"Git configured to commit as {bot_username}")

def check_repo_access(sandbox: Sandbox, owner: str, repo_name: str, username: str) -> bool:
    """
    Check if user has write access to the repository.
    Returns True if user can push to the repo (owner, org member, or collaborator).
    """
    print(f"Checking access for {username} to {owner}/{repo_name}...")
    
    # Method 1: Check if user owns the repo
    if owner.lower() == username.lower():
        print(f"User {username} owns the repository")
        return True
    
    # Method 2: Use gh CLI to check repo access
    # This will check if user has push access (collaborator or org member with write)
    check_access = sandbox.exec(
        "gh", "api", 
        f"/repos/{owner}/{repo_name}/collaborators/{username}/permission",
        "--jq", ".permission"
    )
    check_access.wait()
    
    if check_access.returncode == 0:
        permission = check_access.stdout.read().strip()
        print(f"User {username} has {permission} permission")
        # admin, maintain, or write permissions mean we can push
        if permission in ["admin", "maintain", "write"]:
            return True
    
    # Method 3: Check if it's an org repo and user is a member with access
    check_org_membership = sandbox.exec(
        "gh", "api", 
        f"/orgs/{owner}/members/{username}",
        "--silent"
    )
    check_org_membership.wait()
    
    if check_org_membership.returncode == 0:
        # User is an org member, now check if they have repo access
        check_repo_teams = sandbox.exec(
            "gh", "api",
            f"/repos/{owner}/{repo_name}",
            "--jq", ".permissions.push"
        )
        check_repo_teams.wait()
        
        if check_repo_teams.returncode == 0:
            has_push = check_repo_teams.stdout.read().strip()
            if has_push == "true":
                print(f"User {username} has push access via org membership")
                return True
    
    print(f"User {username} does not have write access to {owner}/{repo_name}")
    return False
