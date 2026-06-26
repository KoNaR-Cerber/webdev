import React, { useState, useEffect} from "react";

const GpsWidget = () => {
    const [gpsData, setGpsData] = useState({latitude: 0.0, longitude: 0.0 });
    const [apiStatus, setApiStatus] = useState('Connecting...');

    useEffect(() => {
        const fetchGpsData = async () => {
            try {
                const response = await fetch('/api/v1/gps/data');
                if (!response.ok) {
                    throw new Error('HTTP error! Status: ${response.status}');
                }

                const data = await response.json();

                if (data && data.latitude !== undefined && data.longitude !== undefined) {
                    setGpsData({ latitude: data.latitude, longitude: data.longitude });
                    setApiStatus('Connected');
                } else {
                    setApiStatus('Incorrect data format');
                }
            } catch (error) {
                console.error("Error getting GPS data from the API:", error);
                setApiStatus('Connection Error');
            }
        };
        
        fetchGpsData();

        const intervalId = setInterval(fetchGpsData, 2000);

        return clearInterval(intervalId);
    }, []);

    return (
        <div className="widget-container" style={{ alignItems: 'center', justifyContent: 'center' }}>            
            <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>latitude: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.latitude.toFixed(6)}
                </span>
            </div>
            
            <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>longitude: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.longitude.toFixed(6)}
                </span>
            </div>

            <div style={{ 
                marginTop: '16px', 
                fontSize: '12px', 
                color: apiStatus === 'Connected' ? 'var(--accent-blue)' : 'var(--accent-red)' 
            }}>
                API: {apiStatus}
            </div>
        </div>
    );
}

export default GpsWidget;