from pydantic import BaseModel, Field
from datetime import datetime


class RosSubscriptionRequest(BaseModel):
    topic: str
    message_type: str


class MQTTSubscriptionRequest(BaseModel):
    topic: str


class GPSDataSchema(BaseModel):
    date: datetime | None = Field(default=None, description="Decoded UTC time representation")
    altitude: float = Field(default=0.0, description="Altitude in meters")
    longitude: float = Field(default=0.0, description="Longitude coordinates")
    latitude: float = Field(default=0.0, description="Latitude coordinates")
    satellites: int = Field(default=0, ge=0, le=255, description="Number of tracked satellites (uint8_t equivalents)")
    fix_quality: int = Field(default=0, description="GPS signal fix status (int32_t equivalent)")
    is_valid: bool = False

    class Config:
        populate_by_name = True
