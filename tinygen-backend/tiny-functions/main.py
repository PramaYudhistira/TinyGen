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
    timeout=1800  # 30 minutes timeout for running Claude
)
def run_claude_agent(repo_url: str, user_github_username: str, chat_id: str, prompt: str) -> Dict:
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
    import json
    import tempfile
    from prompts import INITIAL_SYSTEM_PROMPT, REFLECTION_SYSTEM_PROMPT
    
    # Initialize Supabase client with service role key to bypass RLS
    # This is needed because we're inserting messages on behalf of the user
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(supabase_url, supabase_key)
    
    # Test Supabase connection
    try:
        test_result = supabase.table('messages').select('id').limit(1).execute()
        print(f"Supabase connection test successful. URL: {supabase_url}")
    except Exception as e:
        print(f"ERROR: Failed to connect to Supabase: {str(e)}")
        print(f"URL: {supabase_url}")
        return {"status": "error", "error": f"Supabase connection failed: {str(e)}"}
    
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
        branch_name = f"tinygen-{chat_id[:8]}-{int(time.time())}"
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
    try:
        options = ClaudeCodeOptions(
            model="claude-sonnet-4-20250514",
            cwd=".",  # Use current directory since we already chdir'd
            permission_mode="acceptEdits",
            system_prompt={json.dumps(INITIAL_SYSTEM_PROMPT)},
            max_turns=50,
            allowed_tools=["Read", "Write", "Edit", "Bash", "Grep", "Glob", "LS"]
        )
        
        # Query with the provided prompt
        async for message in query(prompt="{prompt}", options=options):
            # Format and print ONLY the actual messages
            display_messages = format_message_for_display(message)
            
            for msg in display_messages:
                print("CHAT_MESSAGE:" + CHAT_ID + ":" + msg, flush=True)
                sys.stdout.flush()  # Force flush to ensure parent process sees it
        
    except Exception as e:
        # Don't print errors - they'll just pollute the output
        pass

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
        print(f"Starting to read Claude output for chat {chat_id}...")
        message_count = 0
        for line in claude_process.stdout:
            line = line.strip()
            output_lines.append(line)
            
            # ONLY process lines that start with CHAT_MESSAGE: - everything else is debug crap
            if line.startswith("CHAT_MESSAGE:") and ":" in line[13:]:
                # Parse the message format CHAT_MESSAGE:chat_id:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    message_content = parts[2]
                    message_count += 1
                    print(f"Processing message #{message_count} for chat {chat_id}")
                    
                    # Check if this is a tool use message
                    is_tool_use = message_content.startswith('TOOL_USE_JSON:')
                    
                    if is_tool_use:
                        # Parse the tool use data
                        try:
                            tool_json = message_content[len('TOOL_USE_JSON:'):]
                            tool_data = json.loads(tool_json)
                            
                            # Insert as a structured tool use message
                            try:
                                result = supabase.table('messages').insert({
                                    'chat_id': chat_id,
                                    'content': f"Using tool: {tool_data.get('description', 'Unknown')}",
                                    'role': 'assistant',
                                    'is_tool_use': True,
                                    'metadata': {
                                        'tool_data': tool_data
                                    }
                                }).execute()
                                if result.data:
                                    print(f"Successfully inserted tool use message: {result.data[0]['id']}")
                                else:
                                    print(f"Warning: Insert returned no data")
                            except Exception as e:
                                print(f"ERROR inserting tool use message: {str(e)}")
                                print(f"Chat ID: {chat_id}")
                                print(f"Tool data: {tool_data}")
                        except json.JSONDecodeError:
                            print(f"Failed to parse tool use JSON: {message_content}")
                            # Fall back to regular message
                            result = supabase.table('messages').insert({
                                'chat_id': chat_id,
                                'content': message_content,
                                'role': 'assistant',
                                'is_tool_use': False,
                                'metadata': {}
                            }).execute()
                            print(f"Inserted fallback message: {result.data}")
                    else:
                        # Regular text message
                        try:
                            result = supabase.table('messages').insert({
                                'chat_id': chat_id,
                                'content': message_content,
                                'role': 'assistant',
                                'is_tool_use': False,
                                'metadata': {}
                            }).execute()
                            if result.data:
                                print(f"Successfully inserted regular message: {result.data[0]['id']}")
                                print(f"Message preview: {message_content[:100]}...")
                            else:
                                print(f"Warning: Insert returned no data for regular message")
                        except Exception as e:
                            print(f"ERROR inserting regular message: {str(e)}")
                            print(f"Chat ID: {chat_id}")
                            print(f"Message content: {message_content[:200]}...")
            # Ignore all non-CHAT_MESSAGE lines
        
        # Wait for process to complete
        exit_code = claude_process.wait()
        print(f"Claude process exited with code: {exit_code}")
        print(f"Total messages processed: {message_count}")
        
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
                'is_tool_use': False,
                'metadata': {}
            }).execute()
            
            # Set pr_url to None when no changes
            pr_url = None
        else:
            print(f"Changes detected:\n{status_output}")
            
            # Add all changes first
            print("Adding all changes...")
            add_process = sandbox.exec("git", "-C", "/tmp/repo", "add", "-A")
            add_process.wait()
            print(f"Git add exit code: {add_process.returncode}")
            
            # Capture the diff after staging
            print("Capturing diff...")
            diff_process = sandbox.exec("git", "-C", "/tmp/repo", "diff", "--staged")
            diff_process.wait()
            diff_output = diff_process.stdout.read()
            
            # Send a message with the diff
            if diff_output:
                # Truncate diff if it's too long
                max_diff_length = 10000
                if len(diff_output) > max_diff_length:
                    diff_output = diff_output[:max_diff_length] + "\n\n... (diff truncated)"
                
                supabase.table('messages').insert({
                    'chat_id': chat_id,
                    'content': f"📝 **Changes to be committed:**\n\n```diff\n{diff_output}\n```",
                    'role': 'assistant',
                    'is_tool_use': False,
                    'metadata': {
                        'is_diff': True
                    }
                }).execute()
            
            # Run reflection Claude to review changes before committing
            print("Running reflection review...")
            supabase.table('messages').insert({
                'chat_id': chat_id,
                'content': "🔍 **Reviewing changes before creating PR...**\n\nRunning a final review to ensure code quality and completeness.",
                'role': 'assistant',
                'is_tool_use': False,
                'metadata': {}
            }).execute()
            
            # Create reflection Claude script
            reflection_prompt = f"Review the changes that were just made. The original request was: '{prompt}'. Check if the implementation is correct, complete, and follows best practices. Fix any issues you find."
            
            reflection_code = f'''
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
                        
                elif tool_name == "Edit":
                    tool_data["description"] = "Edited file"
                    tool_data["icon"] = "📝"
                    if "file_path" in tool_input:
                        tool_data["summary"] = tool_input["file_path"]
                        
                elif tool_name == "Bash":
                    tool_data["description"] = "Ran command"
                    tool_data["icon"] = "💻"
                    if "command" in tool_input:
                        tool_data["summary"] = tool_input["command"]
                        
                else:
                    tool_data["description"] = "Using " + tool_name
                    tool_data["icon"] = "🔧"
                    tool_data["summary"] = tool_name
                
                # Send as JSON string with special marker
                outputs.append("TOOL_USE_JSON:" + json.dumps(tool_data, ensure_ascii=False))
        
        return outputs
    
    return []

async def main():
    try:
        options = ClaudeCodeOptions(
            model="claude-sonnet-4-20250514",
            cwd=".",  # Use current directory since we already chdir'd
            permission_mode="acceptEdits",
            system_prompt={json.dumps(REFLECTION_SYSTEM_PROMPT)},
            max_turns=20,
            allowed_tools=["Read", "Write", "Edit", "Bash", "Grep", "Glob", "LS"]
        )
        
        # Query with the reflection prompt
        async for message in query(prompt="{reflection_prompt}", options=options):
            # Format and print ONLY the actual messages
            display_messages = format_message_for_display(message)
            
            for msg in display_messages:
                print("CHAT_MESSAGE:" + CHAT_ID + ":🔍 REVIEW: " + msg, flush=True)
                sys.stdout.flush()  # Force flush to ensure parent process sees it
        
    except Exception as e:
        # Don't print errors - they'll just pollute the output
        pass

asyncio.run(main())
'''
            
            # Write the reflection script
            print("Writing reflection script...")
            write_reflection = sandbox.exec(
                "sh", "-c", f"cat > /tmp/reflection_runner.py << 'EOF'\\n{reflection_code}\\nEOF"
            )
            write_reflection.wait()
            
            # Run reflection Claude
            print("Running reflection Claude...")
            reflection_process = sandbox.exec(
                "python", "-u", "/tmp/reflection_runner.py"
            )
            
            # Stream reflection output
            for line in reflection_process.stdout:
                line = line.strip()
                
                if line.startswith("CHAT_MESSAGE:") and ":" in line[13:]:
                    parts = line.split(":", 2)
                    if len(parts) >= 3:
                        message_content = parts[2]
                        
                        # Check if this is a tool use message
                        is_tool_use = message_content.startswith('TOOL_USE_JSON:')
                        
                        if is_tool_use:
                            try:
                                tool_json = message_content[len('TOOL_USE_JSON:'):]
                                tool_data = json.loads(tool_json)
                                
                                supabase.table('messages').insert({
                                    'chat_id': chat_id,
                                    'content': f"Using tool: {tool_data.get('description', 'Unknown')}",
                                    'role': 'assistant',
                                    'is_tool_use': True,
                                    'metadata': {
                                        'tool_data': tool_data,
                                        'is_reflection': True
                                    }
                                }).execute()
                            except json.JSONDecodeError:
                                pass
                        else:
                            supabase.table('messages').insert({
                                'chat_id': chat_id,
                                'content': message_content,
                                'role': 'assistant',
                                'is_tool_use': False,
                                'metadata': {
                                    'is_reflection': True
                                }
                            }).execute()
            
            reflection_process.wait()
            print("Reflection review completed")
            
            # Capture the final diff after reflection
            print("Capturing final diff after reflection...")
            final_diff_process = sandbox.exec("git", "-C", "/tmp/repo", "diff", "--staged")
            final_diff_process.wait()
            final_diff_output = final_diff_process.stdout.read()
            
            # Send the final diff if it changed
            if final_diff_output != diff_output:
                print("Diff changed after reflection, sending updated diff...")
                max_diff_length = 10000
                if len(final_diff_output) > max_diff_length:
                    final_diff_output = final_diff_output[:max_diff_length] + "\n\n... (diff truncated)"
                
                supabase.table('messages').insert({
                    'chat_id': chat_id,
                    'content': f"📝 **Final changes after review:**\n\n```diff\n{final_diff_output}\n```",
                    'role': 'assistant',
                    'is_tool_use': False,
                    'metadata': {
                        'is_diff': True,
                        'is_final': True
                    }
                }).execute()
            
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
                        'is_tool_use': False,
                        'metadata': {}
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
            pr_title = f"Tinygen AI: {prompt[:60]}..."
            pr_body = f"""This PR was created by Tinygen AI assistant.

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
            
            # Send a message with the PR link
            supabase.table('messages').insert({
                'chat_id': chat_id,
                'content': f"🎉 **Pull Request Created!**\n\n[View PR on GitHub]({pr_url})\n\nYour changes have been pushed to `{branch_name}` and a pull request has been created.",
                'role': 'assistant',
                'is_tool_use': False,
                'metadata': {
                    'is_pr_notification': True,
                    'pr_url': pr_url,
                    'branch_name': branch_name
                }
            }).execute()
        
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


