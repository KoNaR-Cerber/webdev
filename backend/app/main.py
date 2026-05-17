import aiomqtt
from fastapi import FastAPI, status
import asyncio
from contextlib import asynccontextmanager

async def mqtt_subscriber():
    async with aiomqtt.Client("localhost", 1883) as client:
        await client.subscribe("test/topic")
        async for message in client.messages:
            print(f"Received message: {message.payload.decode()}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the MQTT subscriber in the background
    mqtt_task = asyncio.create_task(mqtt_subscriber())
    yield
    # Clean up the MQTT subscriber when the app is shutting down
    mqtt_task.cancel()

app = FastAPI(lifespan=lifespan)

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {"status": "ok"}

