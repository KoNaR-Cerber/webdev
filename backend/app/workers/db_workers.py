import janus
import asyncio
from app.db.database import db_manager


async def parse_ros_message(topic, ros_message):
    # Here you can implement any parsing logic needed to convert the ROS message
    # into a format suitable for InfluxDB. For simplicity, we'll assume the
    # ros_message is already a dictionary of fields.
    out = ros_message
    return {"topic": topic, "data": out}


async def parse_item(item):
    if item[0] == "ros":
        topic = item[1]
        data = item[2]
        return parse_ros_message(topic, data)
    else:
        print(f"Unknown item type: {item[0]}")
        return None


async def influxdb_queue_worker(queue: janus.Queue):
    try:
        while True:
            item = await queue.async_q.get()
            try:
                await db_manager.write_telemetry(item["topic"], item["data"])
            finally:
                queue.async_q.task_done()
    except asyncio.CancelledError:
        print(
            "Entering drain mode: shutdown signal received, processing remaining items in the queue..."
        )
        try:
            while True:
                item = queue.async_q.get_nowait()
                await db_manager.write_telemetry(item["topic"], item["data"])
                queue.async_q.task_done()
        except asyncio.QueueEmpty:
            pass
