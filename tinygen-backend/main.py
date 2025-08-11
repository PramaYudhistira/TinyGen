from modal import App, Image, asgi_app
from tiny_fastapi.app import fastapi_client

fastapi_image = (
    Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi",
        "uvicorn",
        "httpx",
        "pydantic>=2.0",
        "supabase",
    )
    .add_local_dir("tiny_fastapi", remote_path="/root/tiny_fastapi")
)

app = App(name="tinygen-backend")


@app.function(
    image=fastapi_image
    )
@asgi_app()
def serve():
    return fastapi_client