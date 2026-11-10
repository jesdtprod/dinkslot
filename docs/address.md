# Club address (Philippines)

Clubs now store a full Philippine address. Province, city/municipality and barangay are chosen from the **PSGC Cloud API** (`https://psgc.cloud/api`, official PSGC codes, CORS enabled, no key). The component is `js/ph-address.js` and it is used in two places: club registration and Dashboard > Club profile.

| Field | Source |
| --- | --- |
| Manager name | typed (private; shown to the platform admin only) |
| Street / Purok / Sitio | typed |
| Province | PSGC list (82 provinces + "Metro Manila (NCR)") |
| City / Municipality | PSGC list, depends on the province |
| Barangay | PSGC list, depends on the city |
| ZIP code | PSGC ZIP for the city/municipality when it has one (locked); otherwise typed, 4 digits |

## Things to know
- **ZIP coverage:** the API has a ZIP for roughly two thirds of the cities and municipalities (about 570 have none, for example Quezon City, Makati and Caloocan). For those the ZIP box is editable and must be 4 digits. A city's ZIP is shown as one value even where a city has several ZIPs.
- **Metro Manila** has no provinces in PSGC. It is offered as "Metro Manila (NCR)". Manila's barangays belong to its districts, so choose "City of Manila - Binondo" (and so on); the stored city is "City of Manila".
- The API double-encodes some accents ("Las PiÃ±as"); the screen repairs them ("Las Piñas").
- **If the API is unreachable**, the three dropdowns turn into text boxes so registration is never blocked. If one city has no barangay list, only the barangay becomes a text box.
- Responses are cached for the browser session.

## Database (migration `...0017`)
New columns on `tenants`: `manager_name`, `street`, `barangay`, `province`, `zip_code` (4 digits), `psgc_province`, `psgc_city`, `psgc_barangay` (codes). `city` is the city/municipality and `address` is the composed "Street, Brgy. X" so older code and the public page keep working. Only the club owner can change them (column grant + RLS); formats are checked by constraints (the database cannot call the API). `public_clubs` exposes street, barangay, province and ZIP; `manager_name` and the PSGC codes are not public. The platform console shows the manager and place.

## Verification
- Isolation test: 227 checks, 0 failures (new: owner saves the address, ZIP and PSGC format checks, other club's owner and staff cannot edit it, manager not public, platform admin sees it).
- Picker run against the live API in a browser: provinces load (83), Ilocos Norte lists 23 municipalities, Bacarra gives ZIP 2902 and locks it, Quezon City gives no ZIP so it must be typed, Manila districts and "Las Piñas" display correctly, a bad ZIP is refused, the saved values include the PSGC codes.
