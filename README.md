# eLab-Pool-Data-Addon
This is the git repo for Extracellular's pool data addon. It's designed to pool the data from an experiment into a single table or excel file in a section at the end of the experiment.

Table headers are inputted as comma seperated labels when the pool data button is clicked e.g:

```
"Actual PCV, Raw PCV, etc..."
```

### ⚠️ Formatting Warning ⚠️

This addon has only been tested for Extracellular's specific table formats, other formats are not guaranteed to work. 2 example table formats that are known to work are shown below:

| Header | Value |
| :---: | :---: |
| Volume of cell suspension (uL) | 100 |
| Volume of PBS (uL) | 0 |
| Dilution | 1 |
| Raw PCV | 5 |
| Actual PCV | 5 |

| Cell ID | Total Cell 1 | Live Cell 1 | Total Cell 2 | Live Cell 2 | Avg Total Cell | Avg Live Cell |
| :--: | :---: | :---: | :--: | :---: | :---: | :---: |
| ExpID | 1e6 | 9.5e5 | 1.5e6 | 1e6 | 1250000 | 975000 |  

---

To get started you must:
1. Install NodeJS with a version >= 16
2. npm install http-server -g (can add sudo on the front)
3. Get OpenSSL, they ask for a specific version but I got a different one (check [here](https://developer.elabnext.com/docs/getting-started))
4. run to generate keys:
```
$ req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 10000 –nodes
```
5. then make start-up script executable:
```
chmod +x SDK-server.sh
```
6. And you can run the server with:
```
./SDK-server.sh
```

NOTE: ALSO MIGHT NEED TO GENERATE OWN GIT PERSONAL ACCESS TOKEN
