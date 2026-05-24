import roslibpy
import janus

class RosManager:
    """
    Manages the connection to the ROS bridge server.
    By default, it connects to a ROS bridge server running on Wireguard.
        Responsibilities:
        - Establishes and maintains the connection to the ROS bridge server.
        - Provides methods to subscribe to ROS topics and handle incoming messages.
        - Ensures that incoming messages are safely enqueued for asynchronous processing.
    """
    def __init__(self, host='10.13.13.1', port=9090):
        self.host = host
        self.port = port
        self.ros_client = None
        self.active_topics: dict[str,roslibpy.Topic] = {}

    def connect(self, queue: janus.Queue):
        """Connect to the ROS bridge server."""
        self.queue: janus.Queue = queue
        self.ros_client = roslibpy.Ros(host=self.host, port=self.port)
        self.ros_client.run()

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
        if not self.ros_client or not self.ros_client.is_connected:
            raise RuntimeError("ROS bridge is currently offline.")
 
        if topic_name in self.active_topics:
            return False  # Already subscribed

        topic = roslibpy.Topic(self.ros_client, topic_name, message_type)

        def callback(message):
            try:
                # Pack the envelope and drop it into the sync side of the queue
                payload = {"topic": topic_name, "data": message}
                self.queue.sync_q.put(payload, block=False)
            except Exception as e:
                print(f"⚠️ Queue overflow on {topic_name}: {e}")

        topic.subscribe(callback)
        self.active_topics[topic_name] = topic
        print(f"📡 Subscribed to topic: {topic_name} [{message_type}]")
        return True

ros_manager = RosManager()
