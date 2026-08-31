import lz4 from "lz4js";

const extractKey = (bytes) =>
  (((bytes[2] >> 6) & 1) << 7) |
  (((bytes[2] >> 4) & 1) << 6) |
  (((bytes[2] >> 2) & 1) << 5) |
  ((bytes[2] & 1) << 4) |
  (((bytes[3] >> 6) & 1) << 3) |
  (((bytes[3] >> 4) & 1) << 2) |
  (((bytes[3] >> 2) & 1) << 1) |
  (bytes[3] & 1);

const encodeKey = (bytes, value) => {
  bytes[2] =
    (bytes[2] & 0b10101010) |
    (((value >> 7) & 1) << 6) |
    (((value >> 6) & 1) << 4) |
    (((value >> 5) & 1) << 2) |
    ((value >> 4) & 1);
  bytes[3] =
    (bytes[3] & 0b10101010) |
    (((value >> 3) & 1) << 6) |
    (((value >> 2) & 1) << 4) |
    (((value >> 1) & 1) << 2) |
    (value & 1);
};

const decryptX = (buffer) => {
  const input = new Uint8Array(buffer);
  const key = extractKey(input);
  const output = new Uint8Array(input);
  for (let index = output.length; --index >= 4; ) {
    output[index] ^= key;
  }
  return output.subarray(4);
};

const encryptLx = (plain) => {
  const compressed = lz4.compress(plain);
  const output = new Uint8Array(compressed.length);
  output.set(compressed);
  const key = 2 + Math.floor(Math.random() * 248);
  for (let index = Math.min(output.length, 100); --index >= 0; ) {
    output[index] ^= key;
  }
  output[0] = 112;
  output[1] = 108;
  encodeKey(output, key);
  return output;
};

export const convertBinToLx = (buffer) => {
  const input = new Uint8Array(buffer);
  if (input.length > 4 && input[0] === 112 && input[1] === 108) {
    return input;
  }
  if (input.length > 4 && input[0] === 112 && input[1] === 120) {
    return encryptLx(decryptX(input));
  }
  return input;
};

export const persistGameBin = (token, binData) => {
  const converted = convertBinToLx(binData);
  const hex = Array.from(converted)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  localStorage.setItem(`bin_data_${token.id}`, hex);
  localStorage.setItem("current_bin_id", token.id);

  let binList = [];
  try {
    binList = JSON.parse(localStorage.getItem("bin_file_list") || "[]");
  } catch {
    binList = [];
  }

  if (!binList.some((item) => item.id === token.id)) {
    binList.push({
      id: token.id,
      name: token.name || "Token",
      byteLength: binData.byteLength,
      size: `${(binData.byteLength / 1024).toFixed(1)} KB`,
      order: binList.length,
    });
    localStorage.setItem("bin_file_list", JSON.stringify(binList));
  }
};
