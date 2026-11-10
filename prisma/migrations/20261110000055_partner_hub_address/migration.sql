UPDATE warehouses AS w
SET name = left((p.profile ->> 'city') || ' hub', 80),
    address_lines = p.profile -> 'addressLines',
    city = p.profile ->> 'city',
    postal_code = p.profile ->> 'postalCode',
    updated_at = now()
FROM fulfilment_partners AS p
WHERE w.partner_id = p.id
  AND p.profile IS NOT NULL
  AND (w.city IS DISTINCT FROM p.profile ->> 'city'
    OR w.postal_code IS DISTINCT FROM p.profile ->> 'postalCode'
    OR w.address_lines IS DISTINCT FROM p.profile -> 'addressLines');
