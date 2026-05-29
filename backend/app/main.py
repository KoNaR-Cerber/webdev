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


async def ros_connection_monitor():
    while True:
        if not ros_manager.is_connected:
            await asyncio.to_thread(ros_manager.connect)
        await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    queue = janus.Queue(maxsize=100000)
    tasks["queue_worker"] = asyncio.create_task(influxdb_queue_worker(queue))
    print(
        f"🚀 Starting ROS bridge connection to {ros_manager.host}:{ros_manager.port}..."
    )
    ros_manager.queue = queue
    tasks["ros_monitor"] = asyncio.create_task(ros_connection_monitor())
    yield
    ros_manager.terminate()
    for task in ["ros_monitor", "queue_worker"]:
        if task in tasks:
            tasks[task].cancel()

    await asyncio.gather(*[tasks[t] for t in tasks], return_exceptions=True)
    await db_manager.close()


app = FastAPI(lifespan=lifespan)


@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {"status": "ok"}


@app.get("/api/v1/topics", status_code=status.HTTP_200_OK)
async def list_topics():
    return {
        "connected_to_rosbridge": ros_manager.is_connected,
        "active_topics": list(ros_manager.active_topics.keys()),
        "queued_subscriptions": list(ros_manager.desired_subscriptions.keys()),
    }


@app.post("/api/v1/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_topic(req: SubscriptionRequest):
    if not req.topic.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Topic name must start with '/'",
        )

    # We no longer crash if offline; we just queue it.
    success = ros_manager.subscribe(req.topic, req.message_type)
    if not success:
        return {"message": f"Already subscribed (or queued) to topic: {req.topic}"}

    connection_status = (
        "Subscribed" if ros_manager.is_connected else "Queued subscription"
    )
    return {
        "message": f"{connection_status} to topic: {req.topic} with type: {req.message_type}"
    }


# async def mqtt_subscriber():
#     try:
#         async with aiomqtt.Client("localhost", 1883) as client:
#             await client.subscribe("test/topic")
#             async for message in client.messages:
#                 print(f"Received message: {message.payload.decode()}")
#     except Exception as e:
#         print(f"MQTT subscriber error: {e}")
