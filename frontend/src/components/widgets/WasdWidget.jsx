import React, { useState, useEffect, useCallback } from "react";
import { useRobot } from "../../context/RobotContext";

const WasdWidget = () => {
  const {connectionStatus, sendCommand} = useRobot();
  const [keys, setKeys] = useState({
    Q: false,
    W: false,
    E: false,
    A: false,
    S: false,
    D: false,
  });
  const isConnected = connectionStatus === "CONNECTED";
  // Calculate and publish velocity whenever the key state changes
  useEffect(() => {
    if (!isConnected) {
      console.log("Not connected to ROS. Skipping command publish.");
      return;
    }
    // Forward/back
    const linearX = (keys.W ? 1.0 : 0.0) + (keys.S ? -1.0 : 0.0);

    // Strafe left/right (holonomic drive)
    const linearY = (keys.A ? 1.0 : 0.0) + (keys.D ? -1.0 : 0.0);

    // Rotate left/right (CCW/CW)
    const angularZ = (keys.Q ? 1.0 : 0.0) + (keys.E ? -1.0 : 0.0);

    const twistMsg = {
      linear: { x: linearX, y: linearY, z: 0.0 },
      angular: { x: 0.0, y: 0.0, z: angularZ },
    };

    sendCommand("/cmd_vel_server", "geometry_msgs/Twist", twistMsg);
  }, [keys, sendCommand, isConnected]);

  const handleKeyDown = useCallback((e) => {
    const key = e.key.toUpperCase();
    if (["Q", "W", "E", "A", "S", "D"].includes(key)) {
      setKeys((prev) => {
        if (prev[key]) return prev; // Ignore OS auto-repeat keydowns
        return { ...prev, [key]: true };
      });
    }
  }, []);

  const handleKeyUp = useCallback((e) => {
    const key = e.key.toUpperCase();
    if (["Q", "W", "E", "A", "S", "D"].includes(key)) {
      setKeys((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case "CONNECTED":
        return "#4caf50"; // Green
      case "CONNECTING":
        return "#ff9800"; // Orange
      case "ERROR":
        return "#f44336"; // Red
      case "CLOSED":
        return "#9e9e9e"; // Gray
      default:
        return "#9e9e9e";
    }
  };

  const getKeyStyle = (isActive) => ({
    width: "40px",
    height: "40px",
    background: !isConnected ? "#2a2a2a" : isActive ? "#2196f3" : "#555",
    color: isConnected ? "#555" : "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    fontWeight: "bold",
    margin: "4px",
    transition: "background 0.1s",
    boxShadow:
      isActive && isConnected
        ? "inset 0 3px 5px rgba(0,0,0,0.5)"
        : "0 4px 6px rgba(0,0,0,0.3)",
    transform: isActive && isConnected ? "translateY(2px)" : "none",
    userSelect: "none",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "16px",
      }}
    >
      <div style={{ display: "flex" }}>
        <div style={getKeyStyle(keys.Q)}>Q</div>
        <div style={getKeyStyle(keys.W)}>W</div>
        <div style={getKeyStyle(keys.E)}>E</div>
      </div>
      <div style={{ display: "flex" }}>
        <div style={getKeyStyle(keys.A)}>A</div>
        <div style={getKeyStyle(keys.S)}>S</div>
        <div style={getKeyStyle(keys.D)}>D</div>
      </div>
      <div
        style={{
          marginTop: "16px",
          color: "#888",
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        Global Keyboard Control Active
      </div>
      <div
        style={{
          marginTop: "16px",
          color: getStatusColor(),
          fontSize: "13px",
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        Status: {connectionStatus}
      </div>
    </div>
  );
};

export default WasdWidget;

