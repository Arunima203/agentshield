import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-900 dark:text-white mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-300 mb-2">Page Not Found</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-8">The page you're looking for doesn't exist or has been moved.</p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
