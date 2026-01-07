import React, { useRef } from 'react';
import { Upload, FolderInput } from 'lucide-react';

interface FileUploadProps {
  label: string;
  accept?: string;
  onFileSelect?: (file: File) => void;
  onFilesSelect?: (files: File[]) => void;
  status: 'idle' | 'loaded' | 'error';
  folderMode?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
  label, 
  accept = ".xlsx, .xls", 
  onFileSelect, 
  onFilesSelect,
  status,
  folderMode = false
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (folderMode && onFilesSelect) {
        onFilesSelect(Array.from(e.target.files));
      } else if (!folderMode && onFileSelect) {
        onFileSelect(e.target.files[0]);
      }
    }
  };

  const getStatusColor = () => {
    if (status === 'loaded') return 'bg-green-600 hover:bg-green-700 text-white';
    if (status === 'error') return 'bg-red-600 hover:bg-red-700 text-white';
    return 'bg-[#37474f] hover:bg-[#455a64] text-gray-200';
  };

  const inputAttributes = folderMode 
    ? { webkitdirectory: "", directory: "", multiple: true } as any 
    : { accept };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={inputRef}
        onChange={handleChange}
        className="hidden"
        {...inputAttributes}
      />
      <button
        onClick={handleClick}
        className={`w-full px-4 py-3 rounded flex items-center justify-between transition-colors ${getStatusColor()}`}
      >
        <span className="font-medium text-sm flex items-center gap-2">
          {folderMode && <FolderInput size={16} />}
          {label}
        </span>
        {status === 'loaded' ? (
           <span className="text-xs font-bold">✓ READY</span>
        ) : (
           <Upload size={16} />
        )}
      </button>
    </div>
  );
};