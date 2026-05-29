from fastapi import HTTPException
from fastapi import FastAPI, status
import asyncio
from contextlib import asynccontextmanager
import janus
from .db.database import db_manager
from .services.ros_service import ros_manager
from .workers.db_workers import influxdb_queue_worker
from .schemas import SubscriptionRequest


tasks = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    queue = janus.Queue(maxsize=100000)
    tasks["queue_worker"] = asyncio.create_task(influxdb_queue_worker(queue))
    print(f"🚀 Starting ROS bridge connection to {ros_manager.host}:{ros_manager.port}...")
    ros_manager.connect(queue)
    yield
    ros_manager.disconnect()
    if "queue_worker" in tasks:
        tasks["queue_worker"].cancel()
        await asyncio.gather(tasks["queue_worker"], return_exceptions=True)
    await db_manager.close()


app = FastAPI(lifespan=lifespan)


@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {"status": "ok"}


@app.get("/api/v1/topics", status_code=status.HTTP_200_OK)
async def list_topics():
    is_connected: bool = bool(
        ros_manager.ros_client and ros_manager.ros_client.is_connected
    )
    return {
        "connected_to_rosbridge": is_connected,
        "active_topics": list(ros_manager.active_topics.keys()),
    }


@app.post("/api/v1/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_topic(req: SubscriptionRequest):
    if not req.topic.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Topic name must start with '/'",
        )
    try:
        success = ros_manager.subscribe(req.topic, req.message_type)
        if not success:
            return {"message": f"Already subscribed to topic: {req.topic}"}
        return {
            "message": f"Subscribed to topic: {req.topic} with type: {req.message_type}"
        }
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )


# async def mqtt_subscriber():
#     try:
#         async with aiomqtt.Client("localhost", 1883) as client:
#             await client.subscribe("test/topic")
#             async for message in client.messages:
#                 print(f"Received message: {message.payload.decode()}")
#     except Exception as e:
#         print(f"MQTT subscriber error: {e}")
