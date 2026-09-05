import { v2 as cloudinaryV2 } from 'cloudinary';
import { env } from '../config/env';

cloudinaryV2.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const cloudinary = cloudinaryV2;

/**
 * Upload a Buffer to Cloudinary and return the secure URL.
 * Applies auto-quality and size limit transformation.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  publicId?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinaryV2.uploader.upload_stream(
      {
        folder: `logiflow/${folder}`,
        ...(publicId && { public_id: publicId }),
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'limit', quality: 'auto:good' },
        ],
      },
      (error, result) => {
        if (error || !result) {
          reject(new Error(error?.message ?? 'Cloudinary upload failed'));
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/**
 * Delete an asset from Cloudinary by its public_id.
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  await cloudinaryV2.uploader.destroy(publicId);
}
