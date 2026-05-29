import roslibpy
import time
import janus
import os

__host__ = os.getenv("ROSBRIDGE_HOST", "localhost")


class RosManager:
    """
    Manages the connection to the ROS bridge server.
    By default, it connects to a ROS bridge server running on Wireguard.
        Responsibilities:
        - Establishes and maintains the connection to the ROS bridge server.
        - Provides methods to subscribe to ROS topics and handle incoming messages.
        - Ensures that incoming messages are safely enqueued for asynchronous processing.
    """

    def __init__(self, port=9090):
        self.host = __host__
        self.port = port
        self.ros_client = None
        self.active_topics: dict[str, roslibpy.Topic] = {}
        self.desired_subscriptions: dict[str, str] = {}  # topic_name -> message_type
        self.queue: janus.Queue | None = None

    @property
    def is_connected(self) -> bool:
        """Check if the ROS client is currently connected."""
        return bool(self.ros_client and self.ros_client.is_connected)

    def connect(self):
        """Connect to the ROS bridge server."""
        if self.is_connected:
            print("⚠️ Already connected to ROS bridge.")
            return True
        print(f"🚀 Connecting to ROS bridge at {self.host}:{self.port}...")
        try:
            if self.ros_client:
                self.ros_client.terminate()

            self.ros_client = roslibpy.Ros(host=self.host, port=self.port)
            self.ros_client.run()
            time.sleep(1)  # Give it a moment to establish the connection
            if self.ros_client.is_connected:
                print("✅ Successfully connected to ROS bridge.")
                self._resubscribe_all()
                return True
            else:
                print("❌ Failed to connect to ROS bridge.")
                return False
        except Exception as e:
            print(f"❌ Error connecting to ROS bridge: {e}")
            return False

    def disconnect(self):
        """Disconnect from the ROS bridge server and clean up resources."""
        for topic in self.active_topics.values():
            topic.unsubscribe()
        self.active_topics.clear()
        if self.ros_client:
            self.ros_client.terminate()
            self.ros_client = None
        print("🔌 Disconnected from ROS bridge.")

    def subscribe(self, topic_name: str, message_type: str) -> bool:
        """Registers a new topic and binds it to the shared queue."""
        if topic_name in self.desired_subscriptions:
            return False  # Already subscribed
        self.desired_subscriptions[topic_name] = message_type
        if self.is_connected:
            self._create_subscription(topic_name, message_type)
        else:
            print(f"⚠️ Queued subscription to {topic_name} - not connected to ROS bridge.")
        return True

    def _resubscribe_all(self):
        """Resubscribe to all desired topics after reconnecting."""
        self.active_topics.clear()  # Clear existing subscriptions
        for topic_name, message_type in self.desired_subscriptions.items():
            self._create_subscription(topic_name, message_type)

    def _create_subscription(self, topic_name: str, message_type: str):
        if topic_name in self.active_topics:
            return  # Already subscribed

        topic = roslibpy.Topic(self.ros_client, topic_name, message_type)

        def callback(message):
            try:
                if self.queue:
                    payload = {
                        "topic": topic_name,
                        "data": message,
                    }
                    self.queue.sync_q.put(payload)
            except Exception as e:
                print(f"❌ Error enqueuing message from {topic_name}: {e}")

        topic.subscribe(callback)
        self.active_topics[topic_name] = topic
        print(f"✅ Subscribed to topic: {topic_name} with type: {message_type}")


ros_manager = RosManager()
