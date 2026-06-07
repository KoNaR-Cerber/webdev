from fastapi import FastAPI, status, APIRouter
import asyncio
from contextlib import asynccontextmanager
import janus
from .db.database import db_manager
from .services.ros_service import ros_manager
from .services.mqtt_service import mqtt_manager
from .services.test_ros_queue_printer import janus_queue_printer
from .routers import mqtt as mqtt_router, ros as ros_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    app.state.tasks = {}
    queue = janus.Queue(maxsize=100000)
    # app.state.tasks["queue_worker"] = asyncio.create_task(influxdb_queue_worker(queue))
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
    app.state.tasks["queue_worker"] = asyncio.create_task(janus_queue_printer(queue))
    yield
    await mqtt_manager.stop()
    ros_manager.stop_ros_process()
    for task in ["queue_worker"]:
        if task in app.state.tasks:
            app.state.tasks[task].cancel()

    await asyncio.gather(*[app.state.tasks[t] for t in app.state.tasks], return_exceptions=True)
    await db_manager.close()


app = FastAPI(lifespan=lifespan)
api_v1_router = APIRouter(prefix="/api/v1", tags=["api"])
api_v1_router.include_router(mqtt_router.router)
api_v1_router.include_router(ros_router.router)
app.include_router(api_v1_router)

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {
        "status": "ok",
        "rosbridge_connected": ros_manager.is_connected,
        "mqtt_connected": mqtt_manager.is_connected,
        "influxdb_connected": db_manager.is_connected,
    }
