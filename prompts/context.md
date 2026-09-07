Absolutely. I’ve created the AjoCircle Backend V1 codebase as a runnable FastAPI/PostgreSQL project.

Included in V1
JWT authentication
Register
Login
Ajo group management
Create Ajo
Add members
Assign payout positions
Activate an Ajo
Automatic cycle generation
Contribution management
Contribution schedules
Submit contribution
Verify contribution
Payout management
Generate expected payouts
Mark payout as paid
Financial ledger
Audit logging
PostgreSQL database
SQLAlchemy 2
Alembic migrations
Docker + Docker Compose
Swagger/OpenAPI documentation
Health/readiness endpoints
Download the complete backend

Download AjoCircle Backend V1

Project structure
ajocircle-backend-v1/
├── app/
│   ├── api/
│   │   ├── auth.py
│   │   ├── ajo.py
│   │   ├── contributions.py
│   │   ├── payouts.py
│   │   └── routes.py
│   ├── core/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── deps.py
│   │   └── security.py
│   ├── models/
│   │   ├── user.py
│   │   ├── ajo.py
│   │   ├── contribution.py
│   │   ├── payout.py
│   │   ├── ledger.py
│   │   └── audit.py
│   ├── schemas/
│   ├── services/
│   │   ├── audit.py
│   │   └── cycles.py
│   └── main.py
├── migrations/
│   ├── env.py
│   └── versions/
│       └── 0001_initial.py
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── requirements.txt
├── .env.example
└── README.md
Run it
cd ajocircle-backend-v1

cp .env.example .env

docker compose up --build

Then:

docker compose exec api alembic upgrade head

Open:

http://localhost:8000/docs

You'll get the interactive Swagger API.

One important architectural decision: this V1 records and verifies contributions and payouts manually; it does not hold members' money, initiate transfers, or integrate with payment providers. That remains intentionally out of scope for now.

The logical next step is V1.1: add invite-by-phone/WhatsApp, 
Ajo dashboard endpoints, 
contribution history, 
cycle history, 
notifications, 
and admin roles.
