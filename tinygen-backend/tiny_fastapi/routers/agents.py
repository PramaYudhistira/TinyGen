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


