UPDATE countries
SET config = jsonb_set(config, '{partners,platformInsuranceCoverMinor}', '0'::jsonb)
WHERE config #> '{partners,platformInsuranceCoverMinor}' IS NOT NULL;
