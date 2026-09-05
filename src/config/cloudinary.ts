import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/**
 * Upload a buffer to Cloudinary and return the secure URL
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  publicId?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadOptions: Parameters<typeof cloudinary.uploader.upload_stream>[0] = {
      folder: `logiflow/${folder}`,
      ...(publicId && { public_id: publicId }),
      resource_type: 'image',
      transformation: [{ width: 500, height: 500, crop: 'limit', quality: 'auto' }],
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error || !result) {
        reject(new Error(error?.message ?? 'Cloudinary upload failed'));
        return;
      }
      resolve(result.secure_url);
    });

    stream.end(buffer);
  });
}

/**
 * Delete an asset from Cloudinary by public ID
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
