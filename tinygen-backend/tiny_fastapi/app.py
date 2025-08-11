from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware



fastapi_client = FastAPI(
    title="TinyGen API",
)

fastapi_client.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # replace this with actual origin of frontend app when we deploy frfr
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_client.get("/")
def read_root():
    return {"message": "Hello, World!"}