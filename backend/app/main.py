from fastapi import FastAPI, status
import asyncio
from contextlib import asynccontextmanager
import janus
from .db.database import db_manager
from .services.ros_service import ros_manager
from .workers.db_workers import influxdb_queue_worker


tasks = {}
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    queue = janus.Queue(maxsize=100000)
    tasks['queue_worker'] = asyncio.create_task(influxdb_queue_worker(queue))
    ros_manager.connect(queue)
    yield
    ros_manager.disconnect()
    if 'queue_worker' in tasks:
        tasks['queue_worker'].cancel()
        await asyncio.gather(tasks['queue_worker'], return_exceptions=True)
    await db_manager.close()

app = FastAPI(lifespan=lifespan)

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {"status": "ok"}

@app.get("/api/v1/topics", status_code=status.HTTP_200_OK)
async def list_topics():
    is_connected: bool = bool(ros_manager.ros_client and ros_manager.ros_client.is_connected)
    return {
        "connected_to_rosbridge": is_connected,
        "active_topics": list(ros_manager.active_topics.keys())
    }
@app.post("/api/v1/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_topic(topic_name: str, message_type: str):
    try:
        success = ros_manager.subscribe(topic_name, message_type)
        if not success:
            return {"message": f"Already subscribed to topic: {topic_name}"}
        return {"message": f"Subscribed to topic: {topic_name} with type: {message_type}"}
    except Exception as e:
        return {"error": str(e)}


# async def mqtt_subscriber():
#     try:
#         async with aiomqtt.Client("localhost", 1883) as client:
#             await client.subscribe("test/topic")
#             async for message in client.messages:
#                 print(f"Received message: {message.payload.decode()}")
#     except Exception as e:
#         print(f"MQTT subscriber error: {e}")
