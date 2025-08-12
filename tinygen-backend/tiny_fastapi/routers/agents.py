from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from modal import Function
from supabase import create_client, Client
import os
from typing import Optional

router = APIRouter()

# Supabase client - using env vars from Modal secrets
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_ANON_KEY")

# Initialize Supabase client if credentials are available
supabase: Optional[Client] = None
if supabase_url and supabase_key:
    supabase = create_client(supabase_url, supabase_key)

# Request/Response models
class CreateSandboxRequest(BaseModel):
    chat_id: str
    repo_url: str
    user_github_username: str

class CreateSandboxResponse(BaseModel):
    status: str
    snapshot_id: Optional[str] = None
    fork_url: Optional[str] = None
    original_repo: Optional[str] = None
    error: Optional[str] = None

@router.post("/create-sandbox", response_model=CreateSandboxResponse)
async def create_sandbox(request: CreateSandboxRequest):
    """
    Create or restore a sandbox for a GitHub repo.
    If user owns the repo, clones directly. Otherwise, forks first.
    Stores the snapshot ID in the chat record.
    """
    try:
        # Get the Modal function using Function.from_name
        fork_and_clone_repo = Function.from_name("tinygen-functions", "fork_and_clone_repo")
        
        # Use spawn to run async and let Modal update the DB
        call = fork_and_clone_repo.spawn(
            repo_url=request.repo_url,
            user_github_username=request.user_github_username,
            chat_id=request.chat_id
        )
        
        # Wait for the result
        result = call.get()
        
        if result["status"] == "success":
            # The Modal function already updated the DB
            return CreateSandboxResponse(
                status="success",
                snapshot_id=result['snapshot_id'],
                fork_url=result.get('clone_url'),
                original_repo=result.get('original_repo')
            )
        else:
            return CreateSandboxResponse(
                status="error",
                error=result.get('error', 'Unknown error')
            )
            
    except Exception as e:
        return CreateSandboxResponse(
            status="error",
            error=str(e)
        )

@router.get("/hello")
def hello_world():
    return {"message": "Hello World from agents"}

@router.get("/check-github-app/{username}")
async def check_github_app_installation(username: str):
    """
    Check if the GitHub App is installed for a user
    """
    import jwt
    import time
    import requests
    
    try:
        # Get GitHub App credentials from environment
        client_id = os.getenv("GITHUB_CLIENT_ID")
        private_key = os.getenv("GITHUB_PRIVATE_KEY")
        
        if not client_id or not private_key:
            return {"installed": False, "error": "GitHub App not configured"}
        
        # Format private key if needed
        if not private_key.startswith("-----BEGIN RSA PRIVATE KEY-----"):
            import textwrap
            key_lines = textwrap.wrap(private_key, 64)
            formatted_key = "\n".join(key_lines)
            private_key = f"-----BEGIN RSA PRIVATE KEY-----\n{formatted_key}\n-----END RSA PRIVATE KEY-----"
        
        # Generate JWT token
        now = int(time.time())
        payload = {
            "iat": now - 60,
            "exp": now + 540,
            "iss": client_id
        }
        jwt_token = jwt.encode(payload, private_key, algorithm="RS256")
        
        # Check if app is installed for the user
        headers = {
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # Get all installations
        response = requests.get(
            "https://api.github.com/app/installations",
            headers=headers
        )
        
        if response.status_code == 200:
            installations = response.json()
            # Check if any installation is for this user
            for installation in installations:
                if installation.get("account", {}).get("login", "").lower() == username.lower():
                    return {
                        "installed": True,
                        "installation_id": installation.get("id"),
                        "account": installation.get("account", {}).get("login")
                    }
        
        return {"installed": False}
        
    except Exception as e:
        return {"installed": False, "error": str(e)}

class RunClaudeAgentRequest(BaseModel):
    chat_id: str
    repo_url: str
    user_github_username: str
    prompt: str

class RunClaudeAgentResponse(BaseModel):
    status: str
    snapshot_id: Optional[str] = None
    repo_url: Optional[str] = None
    pr_url: Optional[str] = None
    branch_name: Optional[str] = None
    forked: Optional[bool] = None
    error: Optional[str] = None

@router.post("/run-claude-agent", response_model=RunClaudeAgentResponse)
async def run_claude_agent(request: RunClaudeAgentRequest):
    """
    Run Claude agent on a GitHub repository with a given prompt.
    This will fork (if needed), clone, run Claude, stream output, create PR, and save snapshot.
    """
    try:
        # Get the Modal function
        run_claude_func = Function.from_name("tinygen-functions", "run_claude_agent")
        
        # Call it asynchronously
        call = run_claude_func.spawn(
            repo_url=request.repo_url,
            user_github_username=request.user_github_username,
            chat_id=request.chat_id,
            prompt=request.prompt
        )
        
        # Since this is a long-running operation, we return immediately
        # The function will stream updates via Supabase Realtime
        return RunClaudeAgentResponse(
            status="started",
            error=None
        )
        
    except Exception as e:
        return RunClaudeAgentResponse(
            status="error",
            error=str(e)
        )


