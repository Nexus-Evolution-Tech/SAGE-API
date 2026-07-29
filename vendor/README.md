# Dependências vendorizadas

## SheetJS CE 0.20.3

- Origem oficial: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- Licença: Apache-2.0

O npm público oferece apenas `xlsx@0.18.5`, afetado por prototype pollution e ReDoS. O próprio
SheetJS recomenda usar e vendorizar o tarball do CDN oficial. Manter o arquivo local também impede
que um build de release dependa da disponibilidade futura do CDN.
