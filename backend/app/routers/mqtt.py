from app.schemas import GPSDataSchema
from fastapi import APIRouter, HTTPException, status, Request
from ..schemas import MQTTSubscriptionRequest
from ..services.mqtt_service import mqtt_manager

# full path : /api/v1/mqtt
router = APIRouter(prefix="/mqtt", tags=["mqtt"])

@router.get("/topics", status_code=status.HTTP_200_OK)
async def list_mqtt_topics():
    return {
        "connected_to_mqtt": mqtt_manager.is_connected,
        "subscribed_topics": list(mqtt_manager.subscriptions),
    }

@router.post("/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_to_mqtt_topic(topic: MQTTSubscriptionRequest):
    if topic.topic.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="MQTT topic name must start without '/'",
        )
    mqtt_manager.add_subscription(topic.topic)
    return {"message": f"Subscribed to MQTT topic: {topic.topic}"}

@router.get("/gps",response_model=GPSDataSchema, status_code=status.HTTP_200_OK)
async def get_gps_data(req: Request):
    fallback = GPSDataSchema()
    return getattr(req.app.state, "latest_gps_data", fallback)
