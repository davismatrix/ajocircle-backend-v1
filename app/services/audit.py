from app.models.audit import AuditLog

def audit(db, **kwargs):
    db.add(AuditLog(**kwargs))
