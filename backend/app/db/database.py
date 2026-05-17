from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
from influxdb_client.client.write.point import Point
import os
from datetime import datetime
from app.common.decorators import throws

INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET")

@throws(ValueError, reason="INFLUXDB_BUCKET environment variable is not set")
async def write_sensor_data(data):
    if not INFLUXDB_BUCKET:
        raise ValueError("INFLUXDB_BUCKET environment variable is not set")
    async with InfluxDBClientAsync.from_env_properties() as client:
        point = (
            Point("robot_data")
            .tag("robot_id", data.get("robot_id"))

        )
        robot_time = data.get("timestamp")
        try:
            dt = datetime.fromisoformat(robot_time)
            if dt.year > 1970:  # Ensure the timestamp is valid
                point.time(dt)
            else:
                print(f"WARNING: Invalid timestamp (year <= 1970): {robot_time}")
                print("Using server time instead.")
        except Exception as e:
            print(f"Invalid timestamp format: {robot_time}")
            print("Using server time instead.")
        write_api = client.write_api()
        await write_api.write(bucket=INFLUXDB_BUCKET, record=point)
