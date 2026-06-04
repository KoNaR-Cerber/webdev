.PHONY: default help rebuild-frontend all fast

default: help

help:
	@echo "Usage: make [target]"
	@echo "Targets:"
	@echo "  all                 Rebuilds the entire docker environment (frontend, backend, nginx) and restarts all services"
	@echo "  fast                Quickly restarts all services without rebuilding (useful for configuration changes)"
	@echo "  help                Show this help message"
	@echo "  rebuild-frontend    Rebuilds the frontend and restarts nginx to serve the new build"
	@echo "  rebuild-backend     Rebuilds the backend and restarts the server to serve the new build"

all:
	@echo "Rebuilding entire docker environment..."
	@echo "Stopping all services..."
	docker compose down -v
	@echo "Rebuilding all services and restarting..."
	docker compose up -d --build
	@echo "Done!"

fast:
	@echo "Quick restart of all services without rebuilding..."
	@echo "Stopping all services..."
	docker compose down
	@echo "Restarting all services..."
	docker compose up -d
	@echo "Done!"

rebuild-frontend:
	@echo "Rebuilding frontend..."
	@echo "Stopping nginx and frontend services..."
	docker compose rm -fs nginx frontend
	@echo "Removing named volume for frontend build cache..."
	docker volume rm -f cerber-project_frontend-dist || true
	@echo "Rebuilding frontend and restarting nginx..."
	docker compose up -d --build nginx frontend
	@echo "Done!"

rebuild-backend:
	@echo "Rebuilding backend..."
	@echo "Stopping backend service..."
	docker compose rm -fs backend
	@echo "Rebuilding backend and restarting server..."
	docker compose up -d --build backend
	@echo "Done!"


