-- Sample signs for LOCAL development only (`supabase db reset` applies this).
-- Do not run against your production project.
insert into public.signs (name, description, price_cents, quantity_available, is_listed)
values
  ('Welcome, Friends', 'Hand-painted cedar, 24" x 8". Weather sealed.', 4500, 1, true),
  ('Coffee First', 'Reclaimed barn wood with white lettering, 16" x 6".', 2800, 3, true),
  ('Home Sweet Home', 'Distressed pine, 30" x 10". One of a kind.', 6500, 1, true),
  ('Gone Fishing', 'Small hanging sign with rope, 12" x 5".', 1800, 0, true),
  ('Workshop (draft)', 'Not listed yet.', 3000, 1, false);
