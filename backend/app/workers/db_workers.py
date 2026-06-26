from app.db.database import db_manager

async def save_to_influxdb(topic: str, data: dict):
    """Streams an incoming telemetry point directly into InfluxDB."""
    try:
        await db_manager.write_telemetry(topic, data)
    except Exception as e:
        print(f"❌ Failed to write topic [{topic}] to InfluxDB: {e}")
