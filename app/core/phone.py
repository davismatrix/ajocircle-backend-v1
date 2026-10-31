import re


def normalize_phone(value: str) -> str:
    """Normalize an explicitly international phone number without guessing a country."""
    if not isinstance(value, str) or not re.fullmatch(r'[+0-9().\-\s]+', value, flags=re.ASCII):
        raise ValueError("Use an international phone number beginning with + and country code")
    number = re.sub(r'[().\-\s]', '', value, flags=re.ASCII)
    if not re.fullmatch(r'\+[1-9][0-9]{6,14}', number, flags=re.ASCII):
        raise ValueError("Use an international phone number beginning with + and country code")
    return number
