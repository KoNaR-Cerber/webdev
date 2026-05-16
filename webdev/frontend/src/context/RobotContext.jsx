import React, {createContext, useContext, useEffect, useState } from 'react'
import mqtt from 'mqtt'

const RobotContext = createContext();

export const RobotProvider = ({ children }) => {
    const [client, setClient] = useState(null);
    const [telemetry, setTelemetry] = useState({});
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // connect to the Nginx proxy path
        // nginx handles SSL, so we use 'wss' if on https and 'ws' if on http 
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const mqttClient = mqtt.connect(`${protocol}://${window.location.host}/mqtt`, {
            keepalive: 60,
            clientId: `web_client_${Math.random().toString(16).slice(3)}`
        });

        mqttClient.on('connect', () => {
            setIsConnected(true);
            mqttClient.subscribe('cerber/telemetry/#');
        });

        mqttClient.on('message', (topic, message) => {
        const data = JSON.parse(message.toString());
        const topicName = topic.split('/').pop();

        if (topicName === 'imu') {
            setTelemetry(prev => ({
            ...prev,
            imu: {
                orientation: data.orientation,
                angular_velocity: data.angular_velocity,
                linear_acceleration: data.linear_acceleration
            }
            }));
        } else {
    setTelemetry(prev => ({ ...prev, [topicName]: data }));
  }
});
        
        setClient(mqttClient);
        return () => mqttClient.end();
    }, []);

    const sendCommand = (subTopic, payload) => {
        if (client && isConnected) {
            client.publish(`cerber/command/${subtopic}`, JSON.stringify(payload));
        }
    };

    return (
        <RobotContext.Provider value={{ telemetry, isConnected, sendCommand }}>
            {children}
        </RobotContext.Provider>
    )
}

export const useRobot = () => useContext(RobotContext);