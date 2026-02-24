from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_list_personas():
    response = client.get("/personas")
    assert response.status_code == 200
    assert "personas" in response.json()
    assert len(response.json()["personas"]) > 0
