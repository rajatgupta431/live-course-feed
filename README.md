# Masterscave course feed

A GitHub Action opens https://www.masterscave.in/courses in a headless Chrome every 6 hours, reads the
"Popular courses" (thumbnail, full name, description, price, buy link) and saves them to `courses.json`.
The /pyq pages on learn.masterscave.in read that file for their course ads.

Setup: create a **public** repository, upload these files (keep the `.github` folder), open the Actions tab,
enable workflows and press "Run workflow" once. Then put the raw link of courses.json, e.g.
`https://raw.githubusercontent.com/<you>/<repo>/main/courses.json`, in `pyq/inc/config.php` as `courses_json_url`.
