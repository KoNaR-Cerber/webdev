import janus
import asyncio
from app.db.database import db_manager
async def influxdb_queue_worker(queue: janus.Queue):
    try:
        while True:
            item = await queue.async_q.get()
            try: 
                await db_manager.write_telemetry(item["topic"], item["data"])
            finally:
                queue.async_q.task_done()
    except asyncio.CancelledError:
        print("Entering drain mode: shutdown signal received, processing remaining items in the queue...")
        while not queue.async_q.empty():
            item = await queue.async_q.get_nowait()
            await db_manager.write_telemetry(item["topic"], item["data"])
            queue.async_q.task_done()
