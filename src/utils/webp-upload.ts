export async function compressWebp(file: File, options: { maxDimension: number; maxBytes: number; square?: boolean }): Promise<string> {
	if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("请选择不超过 10 MB 的图片");
	const bitmap = await createImageBitmap(file);
	try {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("浏览器无法处理图片");
		const sourceSide = Math.min(bitmap.width, bitmap.height);
		let dimension = Math.min(options.maxDimension, options.square ? sourceSide : Math.max(bitmap.width, bitmap.height));
		for (let attempt = 0; attempt < 8; attempt++) {
			const scale = options.square ? 1 : dimension / Math.max(bitmap.width, bitmap.height);
			canvas.width = options.square ? dimension : Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = options.square ? dimension : Math.max(1, Math.round(bitmap.height * scale));
			context.clearRect(0, 0, canvas.width, canvas.height);
			if (options.square) context.drawImage(bitmap, (bitmap.width - sourceSide) / 2, (bitmap.height - sourceSide) / 2, sourceSide, sourceSide, 0, 0, canvas.width, canvas.height);
			else context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const quality = Math.max(0.48, 0.84 - attempt * 0.06);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
			if (!blob || blob.type !== "image/webp") throw new Error("此浏览器不支持 WebP 图片压缩");
			if (blob.size <= options.maxBytes) return await new Promise<string>((resolve, reject) => {
				const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取压缩图片失败")); reader.readAsDataURL(blob);
			});
			dimension = Math.max(320, Math.round(dimension * 0.8));
		}
		throw new Error("图片压缩后仍过大，请选择其他图片");
	} finally { bitmap.close(); }
}
