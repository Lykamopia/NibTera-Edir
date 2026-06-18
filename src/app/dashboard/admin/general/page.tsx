
"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { useSettings } from "@/components/settings-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { uploadBackgroundImage, getBackgroundImages, deleteBackgroundImage } from "@/app/actions/settings";
import Image from "next/image";
import { Upload, Trash2, ImageIcon } from "lucide-react";

function GeneralSettingsSkeleton() {
    return (
        <div className="space-y-6">
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function GeneralSettingsPage() {
  const { settings, loading } = useSettings();
  
  const [bgImages, setBgImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadBgImages();
  }, []);

  const loadBgImages = async () => {
    const images = await getBackgroundImages();
    setBgImages(images);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Frontend validation
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        toast.error("File too large", { description: "Image must be less than 5MB." });
        return;
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        toast.error("Invalid file type", { description: "Only PNG, JPG, and WEBP are allowed." });
        return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
        const result = await uploadBackgroundImage(formData);
        if (result.success) {
            toast.success("Image Uploaded", { description: "The ad image has been added." });
            loadBgImages();
        } else {
            toast.error("Upload Failed", { description: result.error });
        }
    } catch (err) {
        toast.error("Error", { description: "An unexpected error occurred during upload." });
    } finally {
        setIsUploading(false);
        e.target.value = ''; // Reset input
    }
  };

  const handleDeleteImage = async () => {
    if (!imageToDelete) return;

    setIsDeleting(true);
    try {
        const result = await deleteBackgroundImage(imageToDelete);
        if (result.success) {
            toast.success("Image Deleted");
            loadBgImages();
        } else {
            toast.error("Delete Failed", { description: result.error });
        }
    } catch (err) {
        toast.error("Error", { description: "Could not delete image." });
    } finally {
        setIsDeleting(false);
        setImageToDelete(null);
    }
  };

  if (loading) {
    return <GeneralSettingsSkeleton />;
  }
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Login Page Advertisement Images</CardTitle>
          <CardDescription>
            Manage images that appear on the login page background. Only PNG, JPG, and WEBP are supported (Max 5MB).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="flex items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-xl p-8 hover:bg-muted/50 transition-colors relative group">
                <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    disabled={isUploading}
                />
                <div className="flex flex-col items-center gap-2">
                    {isUploading ? (
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    ) : (
                        <Upload className="h-10 w-10 text-muted-foreground group-hover:text-primary transition-colors" />
                    )}
                    <p className="font-medium text-sm">
                        {isUploading ? "Uploading Image..." : "Click or drag to upload ad image"}
                    </p>
                </div>
            </div>

            {bgImages.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {bgImages.map((img, index) => (
                        <div key={index} className="relative aspect-video rounded-lg overflow-hidden border group shadow-sm">
                            <Image
                                src={img}
                                alt={`Ad ${index + 1}`}
                                fill
                                className="object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Button 
                                    variant="destructive" 
                                    size="icon" 
                                    className="h-8 w-8"
                                    onClick={() => setImageToDelete(img)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-10 bg-muted/30 rounded-lg border border-dashed">
                    <ImageIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No ad images uploaded yet.</p>
                </div>
            )}
        </CardContent>
      </Card>

      <AlertDialog open={!!imageToDelete} onOpenChange={(open) => !open && setImageToDelete(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently delete the advertisement image. This action cannot be undone.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                    onClick={(e) => {
                        e.preventDefault();
                        handleDeleteImage();
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={isDeleting}
                >
                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Delete Image
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

    
