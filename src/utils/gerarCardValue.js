const gerarCardValue = (cartaoRfid) => {
  const codigoArea = parseInt(cartaoRfid.slice(0, 3), 10); // 3 primeiros
  const numeroCartao = parseInt(cartaoRfid.slice(3), 10);   // 5 últimos

  const valorApi = BigInt(codigoArea) * 2n ** 32n + BigInt(numeroCartao);

  // Verifique se está dentro do intervalo seguro
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (valorApi > maxSafe) {
    throw new Error(`Valor do cartão RFID excede limite seguro: ${valorApi.toString()}`);
  }

  return Number(valorApi); // agora é seguro retornar como Number
};


module.exports = gerarCardValue;

// console.log(gerarCardValue("15822040")); // 678604854808n

// console.log(gerarCardValue("12345678")); // 528281023086
