import asyncio
import janus

from .mqtt_workers import handle_live_mqtt_state
from .db_workers import save_to_influxdb

async def process_telemetry_item(item, app_state):
    """Routes an item to live state tracking and persistent DB storage simultaneously."""
    source, topic, data = item  # Unpacks ("mqtt" or "ros", topic, data)
    
    if source == "mqtt":
        handle_live_mqtt_state(topic, data, app_state)
    elif source == "ros":
        pass 

    await save_to_influxdb(topic, data)


async def master_ingest_worker(queue: janus.Queue, app_state):
    """The Single Ingest Engine. Coordinates background tasks without bloating files."""
    print("🚀 Master Telemetry Ingest Worker is running...")
    try:
        while True:
            item = await queue.async_q.get()
            try:
                await process_telemetry_item(item, app_state)
            finally:
                queue.async_q.task_done()
                
    except asyncio.CancelledError:
        print("⚠️ Master Worker shutdown received. Entering Queue Drain Mode...")
        try:
            while True:
                item = queue.async_q.get_nowait()
                await process_telemetry_item(item, app_state)
                queue.async_q.task_done()
        except asyncio.QueueEmpty:
            print("🛑 Queue successfully drained. Master Worker stopped cleanly.")
