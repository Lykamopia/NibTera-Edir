
'use client';

export function UserProfileLoader() {
  return (
    <div className="flex items-center justify-center p-8">
       <div className="paper-plane-loader">
        <svg
            className="paper-plane-loader__plane"
            viewBox="0 0 24 24"
            width="64px"
            height="64px"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
            d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
            ></path>
        </svg>
       </div>
    </div>
  );
}
