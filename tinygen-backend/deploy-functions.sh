#!/bin/bash

echo "Deploying TinyGen Modal functions..."

# Deploy the Modal functions from tiny-functions directory using uv
uv run modal deploy tiny-functions/main.py

echo "Deployment complete!"
echo "Your functions are now available at Modal."
echo ""
echo "To test the echo function locally, run:"
echo "uv run modal run tiny-functions/main.py::echo_hello"