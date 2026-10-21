// 
// TO BE CHANGED INTO A MAP?? -- YES
// 

import React, { useState, useEffect} from "react";
import { MapContainer, useMap, TileLayer, Popup, Marker } from "react-leaflet";

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

    const MakeDogMap = () => {
        const map = useMap();
        console.log('map center', map.getCenter());
        return null;
    }
    

    const DogMap = () => {
        return (
            <MapContainer center={[50.5, 30.5]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png"
                        />
                <MakeDogMap />
                <Marker position={[50.5, 30.5]}>
                            <Popup>
                                Robot Position <br />
                                Updated: 
                            </Popup>
                        </Marker>
            </MapContainer>
        )
    }   

const GpsWidget = () => {
    const [gpsData, setGpsData] = useState({
        latitude: 0.0, 
        longitude: 0.0,
        altitude: 0.0, 
        date: "N/A", 
        satellites: 0,
        fix_quality: 0,
        is_valid: false
    });
    const [apiStatus, setApiStatus] = useState('Connecting...');

// MAKING A BEAAAUTIFUL MAPPPP

    useEffect(() => {
        const fetchGpsData = async () => {
            try {
                const response = await fetch('http://localhost:3000/api/v1/gps/data');
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }

                const data = await response.json();

                if (data && data.is_valid) {
                    setGpsData({ 
                        latitude: data.latitude, 
                        longitude: data.longitude,
                        altitude: data.altitude,     
                        date: data.date, 
                        satellites: data.satellites, 
                        fix_quality: data.fix_quality, 
                        is_valid: data.is_valid 
                    });
                    setApiStatus('Connected');
                } else {
                    setApiStatus('Invalid GPS fix');
                }
            } catch (error) {
                console.error("Error getting GPS data from the API:", error);
                setApiStatus('Connection Error');
            }
        };
        
        //fetchGpsData();

        //const intervalId = setInterval(fetchGpsData, 2000);

        return; // () => clearInterval(intervalId);
    }, []);

   // const position = [gpsData.latitude, gpsData.longitude];

    return (
        <div className="widget-container" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
            
            <DogMap />            
            {/* <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>latitude: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.latitude.toFixed(6)}
                </span>
            </div>
             */}
            {/* <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>longitude: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.longitude.toFixed(6)}
                </span>
            </div>

            <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>altitude: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.altitude.toFixed(6)}
                </span>
            </div>

            <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>satellites: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.satellites}
                </span>
            </div>

            <div style={{ fontSize: '18px', fontFamily: 'monospace', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>timestamp: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {gpsData.date}
                </span>
            </div> */}

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