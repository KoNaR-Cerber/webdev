import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as ROSLIB from 'roslib';

const RobotContext = createContext();

export const RobotProvider = ({ children }) => {
    const [ros, setRos] = useState(null);
    const [telemetry, setTelemetry] = useState({ imu: null, battery: 100 });
    
    // We use a ref to cache our ROS topic objects so we don't recreate them on every render
    const topicsRef = useRef({}); 

    useEffect(() => {
        // Default rosbridge port is usually 9090
        const rosClient = new ROSLIB.Ros({
            url: 'ws://10.13.13.2:9090' //      !REPLACE!
        });

        rosClient.on('connection', () => {
            console.log('Connected to websocket server.');
            setRos(rosClient);

            // Example: Subscribing to IMU data natively with roslibjs
            const imuListener = new ROSLIB.Topic({
                ros: rosClient,
                name: '/imu/data',
                messageType: 'sensor_msgs/Imu'
            });

            imuListener.subscribe((message) => {
                setTelemetry(prev => ({ ...prev, imu: message }));
            });
        });

        rosClient.on('error', (error) => console.log('Error connecting to websocket:', error));
        rosClient.on('close', () => console.log('Connection to websocket closed.'));

        return () => rosClient.close();
    }, []);

    // A universal function to send any ROS message
    const sendCommand = useCallback((topicName, messageType, data) => {
        if (!ros) return;

        // Create the topic publisher if it doesn't exist yet
        if (!topicsRef.current[topicName]) {
            topicsRef.current[topicName] = new ROSLIB.Topic({
                ros: ros,
                name: topicName,
                messageType: messageType
            });
        }

        const message = new ROSLIB.Message(data);
        topicsRef.current[topicName].publish(message);
    }, [ros]);

    return (
        <RobotContext.Provider value={{ telemetry, sendCommand }}>
            {children}
        </RobotContext.Provider>
    );
};

export const useRobot = () => useContext(RobotContext);
