from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
from influxdb_client.client.write.point import Point
import os
from datetime import datetime
from app.common.decorators import throws

INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "robot_data")

class InfluxDBManager:
    def __init__(self):
        self.client = None

    async def connect(self):
        """Initialize the InfluxDB client asynchronously."""
        self.client = InfluxDBClientAsync.from_env_properties()
        self.write_api = self.client.write_api()
    @property
    def is_connected(self) -> bool:
        """Check if the InfluxDB client is connected."""
        return self.client is not None
    async def close(self):
        """Close the InfluxDB client connection."""
        if self.client:
            await self.client.close()
    async def write_telemetry(self,topic_name: str, ros_message:dict):
        """Write telemetry data to InfluxDB."""
        try:
            point = Point("ros_telemetry").tag("topic", topic_name)
            has_fields = False

            for key, value in ros_message.items():
                if isinstance(value, (int, float, str, bool)):
                    point.field(key, value)
                    has_fields = True
                else:
                    print(f"Skipping unsupported field type for key: {key}")

            if not has_fields:
                print(f"Skipping telemetry write for topic '{topic_name}': no supported fields found")
                return
            print(f"Writing telemetry data for topic '{topic_name}': {ros_message}")
            await self.write_api.write(bucket=INFLUXDB_BUCKET, record=point)
        except Exception as e:
            print(f"Error writing telemetry data: {e}")


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
        except Exception:
            print(f"Invalid timestamp format: {robot_time}")
            print("Using server time instead.")
        write_api = client.write_api()
        await write_api.write(bucket=INFLUXDB_BUCKET, record=point)

db_manager = InfluxDBManager()
