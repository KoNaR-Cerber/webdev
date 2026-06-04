import React, { useEffect, useRef } from "react";
import { useRobot } from "../../context/RobotContext";
import { useTeleopControls } from "../../hooks/useTeleopControls";
import TeleopButton from "../ui/TeleopButton";

// Map the physical keys to the actions we want to track
const WASD_KEY_MAP = {
    'Q': 'Q', 'W': 'W', 'E': 'E',
    'A': 'A', 'S': 'S', 'D': 'D'
};

const WasdWidget = () => {
    const { connectionStatus, sendCommand } = useRobot();
    const isConnected = connectionStatus === "CONNECTED";
    
    const { activeKeys, handlePointerDown, handlePointerUp } = useTeleopControls(WASD_KEY_MAP);

    const activeKeysRef = useRef(activeKeys);
    useEffect(() => {
        activeKeysRef.current = activeKeys;
    }, [activeKeys]);

    useEffect(() => {
        if (!isConnected) return;

        const intervalId = setInterval(() => {
		const keys = activeKeysRef.current;
        
		const linearX = (keys.W ? 1.0 : 0.0) + (keys.S ? -1.0 : 0.0);
		const linearY = (keys.A ? -1.0 : 0.0) + (keys.D ? 1.0 : 0.0);
		const angularZ = (keys.Q ? 1.0 : 0.0) + (keys.E ? -1.0 : 0.0);

		const twistMsg = {
		    linear: { x: linearX, y: linearY, z: 0.0 },
		    angular: { x: 0.0, y: 0.0, z: angularZ }, 
		};

		sendCommand("/robot/cmd_vel_server", "geometry_msgs/Twist", twistMsg);
        }, 100)

       return () => clearInterval(intervalId);
    }, [sendCommand, isConnected]);

    const getStatusColor = () => {
        if (connectionStatus === "CONNECTED") return "#4caf50";
        if (connectionStatus === "CONNECTING") return "#ff9800";
        if (connectionStatus === "ERROR") return "#f44336";
        return "#9e9e9e";
    };

    // Helper to render buttons quickly
    const renderBtn = (label, action) => (
        <TeleopButton 
            label={label} action={action} isActive={activeKeys[action]} 
            isConnected={isConnected} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} 
        />
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "16px" }}>
            <div style={{ display: "flex" }}>
                {renderBtn("Q", "Q")} {renderBtn("W", "W")} {renderBtn("E", "E")}
            </div>
            <div style={{ display: "flex" }}>
                {renderBtn("A", "A")} {renderBtn("S", "S")} {renderBtn("D", "D")}
            </div>
            
            <div style={{ marginTop: "16px", color: "#888", fontSize: "12px", textAlign: "center" }}>
                Keyboard & UI Control Active
            </div>
            <div style={{ marginTop: "16px", color: getStatusColor(), fontSize: "13px", fontWeight: "bold" }}>
                Status: {connectionStatus}
            </div>
        </div>
    );
};

export default WasdWidget;
