import aiomqtt
import asyncio
import json
import os


class MQTTManager:
    def __init__(self, host="localhost", port=1883, loop=None):
        self.host = os.getenv("MQTT_HOST", host)
        self.port = int(os.getenv("MQTT_PORT", port))
        self.client = None
        self.queue = None
        self._task = None
        self.subscriptions = {}  # topic -> message_type

    @property
    def is_connected(self) -> bool:
        return (
            self.client is not None
            and self.client._client is not None
            and self.client._client.is_connected()
        )

    async def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._message_loop())

    async def _message_loop(self):
        async with aiomqtt.Client(self.host, self.port) as client:
            self.client = client
            for topic in self.subscriptions:
                await client.subscribe(topic)
            async for msg in client.messages:
                payload = msg.payload.decode()
                try:
                    data = json.loads(payload)
                except Exception:
                    data = {"raw": payload}
                item = ("mqtt", str(msg.topic), data)
                try:
                    if self.queue:
                        self.queue.sync_q.put(item)
                except Exception as e:
                    print("Failed to enqueue mqtt message:", e)

    async def stop(self):
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    def add_subscription(self, topic, message_type=None):
        self.subscriptions[topic] = message_type
        if self.client:
            print(f"Adding MQTT subscription to topic: {topic}")
            asyncio.create_task(self.client.subscribe(topic))


mqtt_manager = MQTTManager()
