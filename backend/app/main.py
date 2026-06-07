from fastapi import HTTPException
from fastapi import FastAPI, status
import asyncio
from contextlib import asynccontextmanager
import janus
from .db.database import db_manager
from .services.ros_service import ros_manager
from .services.mqtt_service import mqtt_manager
from .services.test_ros_queue_printer import janus_queue_printer
from .schemas import RosSubscriptionRequest, MQTTSubscriptionRequest


tasks = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db_manager.connect()
    queue = janus.Queue(maxsize=100000)
    # tasks["queue_worker"] = asyncio.create_task(influxdb_queue_worker(queue))
    print(
        f"🚀 Starting ROS bridge connection to {ros_manager.host}:{ros_manager.port}..."
    )
    ros_manager.queue = queue
    ros_manager.start_ros_process()
    ros_manager.subscribe("/test_topic", "std_msgs/String")

    print("🚀 Starting MQTT connection...")
    mqtt_manager.queue = queue
    await mqtt_manager.start()
    mqtt_manager.add_subscription("test/mqtt/topic")
    tasks["queue_worker"] = asyncio.create_task(janus_queue_printer(queue))
    yield
    await mqtt_manager.stop()
    ros_manager.stop_ros_process()
    for task in ["queue_worker"]:
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
        "queued_subscriptions": list(ros_manager.desired_subscriptions.keys()),
    }

@app.post("/api/v1/mqtt/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_to_mqtt_topic(topic: MQTTSubscriptionRequest):
    if topic.topic.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="MQTT topic name must start without '/'",
        )
    mqtt_manager.add_subscription(topic.topic)
    return {"message": f"Subscribed to MQTT topic: {topic.topic}"}

@app.post("/api/v1/ros/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_topic(req: RosSubscriptionRequest):
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
