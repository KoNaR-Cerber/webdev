import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import * as ROSLIB from "roslib";

const RobotContext = createContext();

export const RobotProvider = ({ children }) => {
  const [ros, setRos] = useState(null);
  const [telemetry, setTelemetry] = useState({ imu: null, battery: 100 });
  const [connectionStatus, setConnectionStatus] = useState("CONNECTING");
  // We use a ref to cache our ROS topic objects so we don't recreate them on every render
  const topicsRef = useRef({});

  useEffect(() => {
    const isSecure = window.location.protocol === "https:";
    const protocol = isSecure ? "wss" : "ws";
    const rosURL = `${protocol}://${window.location.host}/rosbridge`; // Adjust path if your rosbridge is served differently
    console.log(`Attempting to connect to ROS at ${rosURL}...`);
    setConnectionStatus("CONNECTING");
    const rosClient = new ROSLIB.Ros({
      url: rosURL,
    });

    rosClient.on("connection", () => {
      console.log("Connected to websocket server.");
      setRos(rosClient);
      setConnectionStatus("CONNECTED")

      // Example: Subscribing to IMU data natively with roslibjs
      const imuListener = new ROSLIB.Topic({
        ros: rosClient,
        name: "/imu/data",
        messageType: "sensor_msgs/Imu",
      });

      imuListener.subscribe((message) => {
        setTelemetry((prev) => ({ ...prev, imu: message }));
      });
    });

    rosClient.on("error", (error) => {
      console.log("Error connecting to websocket:", error);
      console.dir(error);
      setConnectionStatus("ERROR");
      setRos(null);
    });
    rosClient.on("close", () => {
      console.log("Connection to websocket closed.");
      setConnectionStatus("CLOSED");
      setRos(null);
      topicsRef.current = {}; // Clear cached topics on disconnect
    });

    return () => {
      console.log("Cleaning up ROS connection...");
      rosClient.close();
    };
  }, []);

  // A universal function to send any ROS message
  const sendCommand = useCallback(
    (topicName, messageType, data) => {
      if (!ros) {
        console.warn(
          "ROS connection not established yet. Cannot send command.",
        );
        return;
      }

      // Create the topic publisher if it doesn't exist yet
      if (!topicsRef.current[topicName]) {
        console.log(`Creating new ROS topic publisher for ${topicName}...`);
        topicsRef.current[topicName] = new ROSLIB.Topic({
          ros: ros,
          name: topicName,
          messageType: messageType,
        });
      }

      topicsRef.current[topicName].publish(data);
    },
    [ros],
  );

  return (
    <RobotContext.Provider value={{ connectionStatus, telemetry, sendCommand }}>
      {children}
    </RobotContext.Provider>
  );
};

export const useRobot = () => useContext(RobotContext);
