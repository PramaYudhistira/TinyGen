from modal import App, Image, asgi_app, Sandbox, Secret
import subprocess
import json
import os
import time
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
        # Install Claude CLI globally and make sure it's in PATH
        "npm install -g @anthropic-ai/claude-code",
        # Add npm global bin to PATH
        "echo 'export PATH=/usr/local/lib/node_modules/.bin:$PATH' >> ~/.bashrc",
        # Also add to current PATH for immediate use
        "export PATH=/usr/local/lib/node_modules/.bin:$PATH"
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
    .add_local_file("tiny-functions/prompts.py", "/root/prompts.py")
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
    timeout=600
)
def debug_claude_simple(repo_url: str) -> Dict:
    """Debug function - just clone a repo and run Claude with a simple prompt"""
    from supabase import create_client
    from prompts import INITIAL_SYSTEM_PROMPT
    
    # Parse repo URL to get owner and repo
    owner, repo_name = parse_github_url(repo_url)
    print(f"Debug: Cloning {owner}/{repo_name}")
    
    # Create sandbox
    sandbox = Sandbox.create(
        image=sandbox_base_image,
        secrets=[Secret.from_name("all-tinygen")],
        timeout=600
    )
    
    try:
        # Clone with basic auth (public repo)
        print("Cloning repository...")
        clone_process = sandbox.exec(
            "git", "clone", f"https://github.com/{owner}/{repo_name}.git", "/tmp/repo"
        )
        clone_process.wait()
        
        if clone_process.returncode != 0:
            return {"error": f"Clone failed: {clone_process.stderr.read()}"}
        
        print("Repository cloned successfully")
        
        # Create a simple Claude script
        test_prompt = "create a simple hello world python script"
        chat_id = "debug-test"
        
        claude_code = f'''
import asyncio
import json
from claude_code_sdk import query, ClaudeCodeOptions
from claude_code_sdk import AssistantMessage, TextBlock, ToolUseBlock

async def main():
    print("Starting claude-code assistant...", flush=True)
    
    options = ClaudeCodeOptions(
        model="claude-sonnet-4-20250514",
        cwd="/tmp/repo",
        permission_mode="acceptEdits",
        system_prompt={json.dumps(INITIAL_SYSTEM_PROMPT)},
        max_turns=50,
        allowed_tools=["Read", "Write", "Edit", "Bash", "Grep", "Glob", "LS"]
    )
    
    async for message in query(prompt="{test_prompt}", options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    print(f"CLAUDE: {{block.text}}", flush=True)
                elif isinstance(block, ToolUseBlock):
                    print(f"TOOL USE: {{block.name}} - {{block.id}}", flush=True)
    
    print("✅ Task completed!", flush=True)

asyncio.run(main())
'''
        
        # Write and run the script
        print("Writing claude script...")
        write_script = sandbox.exec(
            "sh", "-c", f"cat > /tmp/claude_runner.py << 'EOF'\n{claude_code}\nEOF"
        )
        write_script.wait()
        
        # Test claude CLI first
        print("Testing claude CLI...")
        test_claude = sandbox.exec("claude", "--version")
        test_claude.wait()
        if test_claude.returncode == 0:
            print(f"Claude CLI version: {test_claude.stdout.read().strip()}")
        else:
            print(f"Claude CLI test failed: {test_claude.stderr.read()}")
        
        print("Running Claude script...")
        claude_process = sandbox.exec("python", "-u", "/tmp/claude_runner.py")
        
        # Capture all output
        output = []
        for line in claude_process.stdout:
            print(f"[OUTPUT] {line.strip()}")
            output.append(line.strip())
        
        claude_process.wait()
        
        if claude_process.returncode != 0:
            stderr = claude_process.stderr.read()
            print(f"Claude failed with exit code {claude_process.returncode}")
            print(f"Stderr: {stderr}")
            return {"error": f"Claude failed: {stderr}", "output": output}
        
        # Check if any files were created
        print("Checking for created files...")
        ls_process = sandbox.exec("ls", "-la", "/tmp/repo")
        ls_process.wait()
        print("Files in repo:")
        for line in ls_process.stdout:
            print(f"  {line.strip()}")
        
        return {"success": True, "output": output}
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {"error": str(e)}
    finally:
        sandbox.terminate()


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
                # Wait for fork to be available on GitHub
                print("Waiting for fork to be available...")
                time.sleep(3)  # Give GitHub 3 seconds to make the fork available
            else:
                print("Fork already exists")
            
            clone_url = f"https://github.com/{user_github_username}/{repo_name}.git"
            final_repo = f"{user_github_username}/{repo_name}"
        
        # Clone the repo with retries
        print(f"Cloning {final_repo}...")
        max_retries = 3
        retry_delay = 2
        
        #github is pretty slow to check if fork exists...
        for attempt in range(max_retries):
            clone_process = sandbox.exec(
                "git", "clone", clone_url, "/tmp/repo"
            )
            clone_process.wait()
            
            if clone_process.returncode == 0:
                break
            elif attempt < max_retries - 1:
                error_msg = clone_process.stderr.read()
                print(f"Clone attempt {attempt + 1} failed: {error_msg}")
                if "503" in error_msg or "Service unavailable" in error_msg:
                    print(f"GitHub service unavailable, retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    raise Exception(f"Failed to clone repo: {error_msg}")
            else:
                raise Exception(f"Failed to clone repo after {max_retries} attempts: {clone_process.stderr.read()}")
        
        print(f"Repository {final_repo} cloned successfully")
        
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


@app.function(
    image=sandbox_image,
    secrets=[Secret.from_name("all-tinygen")],
    timeout=1800  # 30 minutes timeout for running Claude
)
async def run_claude_agent(repo_url: str, user_github_username: str, chat_id: str, prompt: str) -> Dict:
    """
    Fork a repo (if needed), clone it, run Claude Code SDK with the prompt,
    stream output to Supabase Realtime, create a PR, and save the snapshot.
    """
    from github_auth import (
        generate_jwt_token,
        get_installation_id,
        get_installation_access_token,
        authenticate_gh_cli,
        setup_git_config,
        check_repo_access
    )
    from supabase import create_client
    import asyncio
    import json
    import tempfile
    from prompts import INITIAL_SYSTEM_PROMPT
    
    # Initialize Supabase client with service role key to bypass RLS
    # This is needed because we're inserting messages on behalf of the user
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(supabase_url, supabase_key)
    
    # Get GitHub App credentials
    client_id = os.environ["GITHUB_CLIENT_ID"]
    private_key = os.environ["GITHUB_PRIVATE_KEY"]
    
    # Parse repo URL
    owner, repo_name = parse_github_url(repo_url)
    
    # Generate JWT token
    jwt_token = generate_jwt_token(client_id, private_key)
    
    # Get installation ID
    installation_id, error = get_installation_id(user_github_username, repo_name, jwt_token)
    if error:
        installation_id, error = get_installation_id(owner, repo_name, jwt_token)
        if error:
            return {"status": "error", "error": error}
    
    # Get access token
    access_token = get_installation_access_token(installation_id, jwt_token)
    
    # Create sandbox with secrets
    sandbox = Sandbox.create(
        image=sandbox_base_image,
        secrets=[Secret.from_name("all-tinygen")],
        timeout=1800
    )
    
    try:
        # Authenticate gh CLI
        authenticate_gh_cli(sandbox, access_token)
        setup_git_config(sandbox)
        
        # Check if user has direct access
        has_access = check_repo_access(sandbox, owner, repo_name, user_github_username)
        
        if has_access:
            clone_url = f"https://github.com/{owner}/{repo_name}.git"
            final_repo = f"{owner}/{repo_name}"
        else:
            # Check/create fork
            check_fork = sandbox.exec(
                "gh", "repo", "view", f"{user_github_username}/{repo_name}",
                "--json", "name"
            )
            check_fork.wait()
            
            if check_fork.returncode != 0:
                print(f"Creating fork of {owner}/{repo_name}...")
                fork_process = sandbox.exec(
                    "gh", "repo", "fork", f"{owner}/{repo_name}", 
                    "--clone=false"
                )
                fork_process.wait()
                if fork_process.returncode != 0:
                    raise Exception(f"Failed to fork repo: {fork_process.stderr.read()}")
                time.sleep(3)
            
            clone_url = f"https://github.com/{user_github_username}/{repo_name}.git"
            final_repo = f"{user_github_username}/{repo_name}"
        
        # Clone the repo
        print(f"Cloning {final_repo}...")
        clone_process = sandbox.exec("git", "clone", clone_url, "/tmp/repo")
        clone_process.wait()
        
        if clone_process.returncode != 0:
            raise Exception(f"Failed to clone repo: {clone_process.stderr.read()}")
        
        # Create branch for changes
        branch_name = f"claude-{chat_id[:8]}-{int(time.time())}"
        sandbox.exec("git", "-C", "/tmp/repo", "checkout", "-b", branch_name).wait()
        
        # Initialize pr_url
        pr_url = None
        
        # Create a simpler Claude runner script
        claude_code = f'''
import sys
import os
import asyncio
import json
from datetime import datetime, timezone

# Change to the repo directory BEFORE importing Claude SDK
os.chdir("/tmp/repo")

from claude_code_sdk import query, ClaudeCodeOptions, Message
from claude_code_sdk import AssistantMessage, UserMessage, TextBlock, ToolUseBlock

CHAT_ID = "{chat_id}"

def format_message_for_display(message):
    """Convert claude-code-sdk messages to human-readable format"""
    if isinstance(message, AssistantMessage):
        outputs = []
        
        for block in message.content:
            if isinstance(block, TextBlock):
                if block.text.strip():
                    outputs.append(block.text)
            elif isinstance(block, ToolUseBlock):
                tool_name = block.name
                tool_input = block.input
                
                # Create structured tool use data
                tool_data = {{
                    "type": "tool_use",
                    "tool_name": tool_name,
                    "tool_id": block.id,
                    "status": "calling",
                    "input": {{}}
                }}
                
                # Add formatted description and key parameters based on tool type
                if tool_name == "Read":
                    tool_data["description"] = "Read file"
                    tool_data["icon"] = "📖"
                    if "file_path" in tool_input:
                        tool_data["summary"] = tool_input["file_path"]
                        
                elif tool_name == "Write":
                    tool_data["description"] = "Wrote file"
                    tool_data["icon"] = "✏️"
                    if "file_path" in tool_input:
                        tool_data["summary"] = tool_input["file_path"]
                    if "content" in tool_input:
                        content = tool_input["content"]
                        lines = content.count('\\n') + 1
                        chars = len(content)
                        preview = content[:500] + "..." if len(content) > 500 else content
                        tool_data["input"]["content_preview"] = preview
                        tool_data["input"]["stats"] = str(lines) + " lines, " + str(chars) + " characters"
                        
                elif tool_name == "Edit":
                    tool_data["description"] = "Edited file"
                    tool_data["icon"] = "📝"
                    if "file_path" in tool_input:
                        tool_data["summary"] = tool_input["file_path"]
                    if "old_string" in tool_input:
                        tool_data["input"]["old_string"] = tool_input["old_string"][:50] + "..." if len(tool_input["old_string"]) > 50 else tool_input["old_string"]
                    if "new_string" in tool_input:
                        tool_data["input"]["new_string"] = tool_input["new_string"][:50] + "..." if len(tool_input["new_string"]) > 50 else tool_input["new_string"]
                        
                elif tool_name == "Bash":
                    tool_data["description"] = "Ran command"
                    tool_data["icon"] = "💻"
                    if "command" in tool_input:
                        tool_data["summary"] = tool_input["command"]
                        
                elif tool_name == "Grep":
                    tool_data["description"] = "Searched files"
                    tool_data["icon"] = "🔍"
                    if "pattern" in tool_input:
                        tool_data["summary"] = "Pattern: " + tool_input["pattern"]
                    if "path" in tool_input:
                        tool_data["input"]["path"] = tool_input["path"]
                        
                elif tool_name == "Glob":
                    tool_data["description"] = "Found files"
                    tool_data["icon"] = "🔍"
                    if "pattern" in tool_input:
                        tool_data["summary"] = tool_input["pattern"]
                        
                elif tool_name == "LS":
                    tool_data["description"] = "Listed directory"
                    tool_data["icon"] = "📁"
                    if "path" in tool_input:
                        tool_data["summary"] = tool_input["path"]
                        
                else:
                    tool_data["description"] = "Using " + tool_name
                    tool_data["icon"] = "🔧"
                    tool_data["summary"] = tool_name
                    tool_data["input"] = tool_input
                
                # Send as JSON string with special marker
                outputs.append("TOOL_USE_JSON:" + json.dumps(tool_data, ensure_ascii=False))
        
        return outputs
    
    return []

async def main():
    print("Starting claude-code assistant...", flush=True)
    
    try:
        options = ClaudeCodeOptions(
            model="claude-sonnet-4-20250514",
            cwd=".",  # Use current directory since we already chdir'd
            permission_mode="acceptEdits",
            system_prompt={json.dumps(INITIAL_SYSTEM_PROMPT)},
            max_turns=50,
            allowed_tools=["Read", "Write", "Edit", "Bash", "Grep", "Glob", "LS"]
        )
        
        # First check what directory we're in
        import os
        print(f"Current directory before query: {{os.getcwd()}}", flush=True)
        
        # Query with the provided prompt
        message_count = 0
        async for message in query(prompt="{prompt}", options=options):
            message_count += 1
            print(f"Received message {{message_count}}: {{type(message)}}", flush=True)
            
            # Format and print messages
            display_messages = format_message_for_display(message)
            print(f"Formatted into {{len(display_messages)}} display messages", flush=True)
            
            for msg in display_messages:
                print("CHAT_MESSAGE:" + CHAT_ID + ":" + msg, flush=True)
        
        print(f"✅ Task completed! Total messages: {{message_count}}", flush=True)
        
    except Exception as e:
        print(f"ERROR in main: {{str(e)}}", flush=True)
        import traceback
        print(f"Traceback: {{traceback.format_exc()}}", flush=True)

asyncio.run(main())
'''
        
        # Write the Claude script using heredoc
        print("Writing Claude script...")
        write_script = sandbox.exec(
            "sh", "-c", f"cat > /tmp/claude_runner.py << 'EOF'\n{claude_code}\nEOF"
        )
        write_script.wait()
        print("Script written successfully")
        
        # Test if claude CLI works at all
        print("Testing claude CLI...")
        test_claude = sandbox.exec("claude", "--version")
        test_claude.wait()
        if test_claude.returncode == 0:
            print(f"Claude CLI version: {test_claude.stdout.read().strip()}")
        else:
            print(f"Claude CLI test failed: {test_claude.stderr.read()}")
            
        # Check environment
        print("Checking environment variables...")
        check_env = sandbox.exec("bash", "-c", "env | grep -E 'ANTHROPIC|PATH' | head -10")
        check_env.wait()
        for line in check_env.stdout:
            print(f"ENV: {line.strip()}")
            
        # Check Python and packages
        print("Checking Python environment...")
        check_python = sandbox.exec("python", "-c", "import sys; print(f'Python: {sys.version}'); import claude_code_sdk; print(f'SDK: {claude_code_sdk.__file__}')")
        check_python.wait()
        for line in check_python.stdout:
            print(f"PYTHON: {line.strip()}")
        if check_python.returncode != 0:
            print(f"Python check failed: {check_python.stderr.read()}")
        
        # Run Claude in the repo directory
        print("Running Claude Code SDK...")
        print(f"Working directory: /tmp/repo")
        print(f"Prompt: {prompt}")
        
        # Run with unbuffered output - exactly like the working tangent-backend
        claude_process = sandbox.exec(
            "python", "-u", "/tmp/claude_runner.py"
        )
        
        # Stream output - we'll send this via the database broadcast method
        # The frontend will subscribe to changes on a messages table
        output_lines = []
        stderr_lines = []
        
        # Read stdout
        for line in claude_process.stdout:
            line = line.strip()
            output_lines.append(line)
            if line.startswith("CHAT_MESSAGE:"):
                # Parse the message format CHAT_MESSAGE:chat_id:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    message_content = parts[2]
                    
                    # Insert message into messages table for realtime broadcast
                    # This assumes you have a messages table that broadcasts changes
                    supabase.table('messages').insert({
                        'chat_id': chat_id,
                        'content': message_content,
                        'role': 'assistant',
                        'created_at': 'now()'
                    }).execute()
            else:
                # Log output but don't send to frontend
                print(f"[Claude Output] {line}")
        
        # Wait for process to complete
        exit_code = claude_process.wait()
        print(f"Claude process exited with code: {exit_code}")
        
        # Read any stderr
        for line in claude_process.stderr:
            stderr_lines.append(line.strip())
            print(f"[Claude Stderr] {line.strip()}")
        
        # If we got no output, check stderr
        if not output_lines:
            print("No output from Claude process. Checking for errors...")
            # The stderr is already being redirected to stdout with 2>&1
        
        if claude_process.returncode != 0:
            stderr_output = claude_process.stderr.read()
            print(f"Claude process failed with exit code {claude_process.returncode}")
            print(f"Claude process stderr: {stderr_output}")
            raise Exception(f"Claude process failed: {stderr_output}")
        
        # Create .gitignore for agent metadata (create directory first)
        print("Creating .agent-metadata directory...")
        sandbox.exec("mkdir", "-p", "/tmp/repo/.agent-metadata").wait()
        sandbox.exec("bash", "-c", "echo '*' > /tmp/repo/.agent-metadata/.gitignore").wait()
        
        # Check if there are any changes
        print("Checking for changes...")
        status_process = sandbox.exec("git", "-C", "/tmp/repo", "status", "--porcelain")
        status_process.wait()
        status_output = status_process.stdout.read().strip()
        
        if not status_output:
            print("No changes detected - Claude didn't modify any files")
            # Still create a message for the user
            supabase.table('messages').insert({
                'chat_id': chat_id,
                'content': "I've analyzed your request but didn't need to make any changes to the repository.",
                'role': 'assistant',
                'created_at': 'now()'
            }).execute()
            
            # Set pr_url to None when no changes
            pr_url = None
        else:
            print(f"Changes detected:\n{status_output}")
            
            # Add and commit changes
            print("Adding all changes...")
            add_process = sandbox.exec("git", "-C", "/tmp/repo", "add", "-A")
            add_process.wait()
            print(f"Git add exit code: {add_process.returncode}")
            
            print("Committing changes...")
            commit_message = f"Apply changes from Claude AI assistant\n\nPrompt: {prompt[:200]}...\n\nChat ID: {chat_id}"
            commit_process = sandbox.exec(
                "git", "-C", "/tmp/repo", "commit", 
                "-m", commit_message
            )
            commit_process.wait()
            print(f"Git commit exit code: {commit_process.returncode}")
            
            if commit_process.returncode != 0:
                commit_stderr = commit_process.stderr.read()
                print(f"Commit stderr: {commit_stderr}")
                # Could be no changes after all
                if "nothing to commit" in commit_stderr:
                    print("Nothing to commit after all")
                    supabase.table('messages').insert({
                        'chat_id': chat_id,
                        'content': "I've analyzed your request but no changes were needed.",
                        'role': 'assistant',
                        'created_at': 'now()'
                    }).execute()
                    return {
                        "status": "success",
                        "snapshot_id": None,
                        "repo_url": f"https://github.com/{final_repo}",
                        "pr_url": None,
                        "branch_name": branch_name,
                        "forked": not has_access
                    }
            
            # Push changes
            print(f"Pushing to branch {branch_name}...")
            push_process = sandbox.exec(
                "git", "-C", "/tmp/repo", "push", 
                "-u", "origin", branch_name
            )
            push_process.wait()
            print(f"Git push exit code: {push_process.returncode}")
            
            if push_process.returncode != 0:
                push_stderr = push_process.stderr.read()
                print(f"Push stderr: {push_stderr}")
                raise Exception(f"Failed to push changes: {push_stderr}")
        
            # Create PR only if we have changes
            print("Creating pull request...")
            pr_title = f"Claude AI: {prompt[:60]}..."
            pr_body = f"""This PR was created by Claude AI assistant.

**Prompt**: {prompt}

**Chat ID**: {chat_id}
**Branch**: {branch_name}

---
*Generated by TinyGen AI Assistant*"""

            print(f"PR Title: {pr_title}")
            print(f"PR Branch: {branch_name}")
            print(f"PR Repo: {final_repo}")
            
            pr_process = sandbox.exec(
                "gh", "pr", "create",
                "--repo", final_repo,
                "--title", pr_title,
                "--body", pr_body,
                "--head", branch_name,
                "--base", "main"
            )
            pr_process.wait()
            print(f"PR create exit code: {pr_process.returncode}")
            
            # Get PR URL from output
            pr_url = pr_process.stdout.read().strip()
            if pr_process.returncode != 0:
                pr_stderr = pr_process.stderr.read()
                print(f"PR create stderr: {pr_stderr}")
                # Sometimes PR URL is in stderr
                if "https://github.com" in pr_stderr:
                    pr_url = pr_stderr.strip()
                else:
                    raise Exception(f"Failed to create PR: {pr_stderr}")
            
            print(f"PR URL: {pr_url}")
        
        # Create final snapshot
        print("Creating final snapshot...")
        snapshot = sandbox.snapshot_filesystem()
        snapshot_id = snapshot.object_id
        
        # Update chat with results
        supabase.table('chats').update({
            'snapshot_id': snapshot_id,
            'github_repo_url': f"https://github.com/{final_repo}",
            'pr_url': pr_url,
            'branch_name': branch_name
        }).eq('id', chat_id).execute()
        
        return {
            "status": "success",
            "snapshot_id": snapshot_id,
            "repo_url": f"https://github.com/{final_repo}",
            "pr_url": pr_url,
            "branch_name": branch_name,
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


